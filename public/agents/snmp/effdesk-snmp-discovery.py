#!/usr/bin/env python3
"""Authorized, read-only SNMPv3 authPriv inventory collector for EffDesk.

Requires Python 3.9+ and pysnmp 7.x. Credentials stay in a local mode-0600 JSON file;
only device inventory and the EffDesk enrollment token are sent to the workspace.
"""
import argparse
import asyncio
import ipaddress
import json
import os
import stat
import sys
import urllib.request
import urllib.error

from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine, UsmUserData, UdpTransportTarget, ContextData,
    ObjectType, ObjectIdentity, get_cmd,
    usmHMAC192SHA256AuthProtocol, usmAesCfb128Protocol,
)

OIDS = [
    ("sysDescr", "1.3.6.1.2.1.1.1.0"),
    ("sysObjectID", "1.3.6.1.2.1.1.2.0"),
    ("sysUpTime", "1.3.6.1.2.1.1.3.0"),
    ("sysName", "1.3.6.1.2.1.1.5.0"),
]


def private_network_targets(values):
    targets = set()
    approved = [ipaddress.ip_network("10.0.0.0/8"), ipaddress.ip_network("172.16.0.0/12"), ipaddress.ip_network("192.168.0.0/16")]
    for value in values:
        network = ipaddress.ip_network(value, strict=False)
        if network.version != 4 or not any(network.subnet_of(scope) for scope in approved):
            raise ValueError("Only explicitly supplied RFC1918 private IPv4 ranges are allowed.")
        for address in network.hosts():
            if address.is_link_local or address.is_loopback or address.is_multicast:
                continue
            targets.add(str(address))
            if len(targets) > 400:
                raise ValueError("A scan is limited to 400 target addresses.")
    if not targets:
        raise ValueError("No usable private-network addresses were supplied.")
    return sorted(targets, key=lambda item: (ipaddress.ip_address(item).version, int(ipaddress.ip_address(item))))


def read_credentials(path):
    if os.name == "posix":
        mode = stat.S_IMODE(os.stat(path).st_mode)
        if mode & 0o077:
            raise ValueError("SNMP credential file must be readable only by its owner (chmod 600).")
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    username = str(data.get("username", "")).strip()
    auth_key = str(data.get("auth_key", ""))
    priv_key = str(data.get("priv_key", ""))
    if not username or len(username) > 32 or len(auth_key) < 8 or len(priv_key) < 8:
        raise ValueError("Credential file must contain a username and separate strong auth_key and priv_key values.")
    if auth_key == priv_key:
        raise ValueError("Use different authentication and privacy secrets.")
    return username, auth_key, priv_key


async def poll_one(engine, ip, user):
    username, auth_key, priv_key = user
    try:
        target = await UdpTransportTarget.create((ip, 161), timeout=1.2, retries=0)
        error, status, index, bindings = await get_cmd(
            engine,
            UsmUserData(username, auth_key, priv_key,
                        authProtocol=usmHMAC192SHA256AuthProtocol,
                        privProtocol=usmAesCfb128Protocol),
            target,
            ContextData(),
            *[ObjectType(ObjectIdentity(oid)) for _, oid in OIDS],
        )
        if error or status:
            return None
        values = {name: str(value) for (name, _), (_, value) in zip(OIDS, bindings)}
        if not any(values.get(k) for k in ("sysName", "sysDescr")):
            return None
        return {
            "ip": ip,
            "sysName": values.get("sysName", "")[:120],
            "sysDescr": values.get("sysDescr", "")[:240],
            "sysObjectId": values.get("sysObjectID", "")[:100],
            "sysUpTime": values.get("sysUpTime", "")[:60],
        }
    except Exception:
        return None


async def collect(targets, credentials):
    engine = SnmpEngine()
    semaphore = asyncio.Semaphore(32)

    async def bounded(ip):
        async with semaphore:
            return await poll_one(engine, ip, credentials)

    try:
        results = await asyncio.gather(*(bounded(ip) for ip in targets))
        return [item for item in results if item]
    finally:
        try:
            engine.close_dispatcher()
        except Exception:
            pass


def send_inventory(api_url, token, devices):
    body = json.dumps({"devices": devices}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        api_url,
        data=body,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
        if response.status >= 300 or not result.get("ok"):
            raise RuntimeError(result.get("error", "EffDesk rejected the network inventory."))
        return result


def main():
    parser = argparse.ArgumentParser(description="Read-only SNMPv3 authPriv network discovery for EffDesk.")
    parser.add_argument("--targets", action="append", required=True, help="Customer-approved private CIDR or IP; repeat for multiple ranges.")
    parser.add_argument("--credentials-file", required=True, help="Local JSON file with SNMPv3 username/auth_key/priv_key (chmod 600).")
    parser.add_argument("--token", default="", help="One-time EffDesk enrollment token (prefer --token-file).")
    parser.add_argument("--token-file", default="", help="Protected file containing the EffDesk enrollment token.")
    parser.add_argument("--api-url", required=True, help="EffDesk endpoint, normally https://app.effdesk.com/api/cmdb-snmp-agent")
    args = parser.parse_args()

    try:
        if not args.api_url.startswith("https://"):
            raise ValueError("EffDesk ingestion requires HTTPS.")
        if bool(args.token) == bool(args.token_file):
            raise ValueError("Provide exactly one of --token or --token-file.")
        token = args.token.strip()
        if args.token_file:
            if os.name == "posix" and stat.S_IMODE(os.stat(args.token_file).st_mode) & 0o077:
                raise ValueError("Enrollment token file must be readable only by its owner (chmod 600).")
            with open(args.token_file, "r", encoding="utf-8") as handle:
                token = handle.read().strip()
        if not token:
            raise ValueError("EffDesk enrollment token is empty.")
        targets = private_network_targets(args.targets)
        credentials = read_credentials(args.credentials_file)
        devices = asyncio.run(collect(targets, credentials))
        if not devices:
            raise RuntimeError("No SNMPv3 authPriv devices responded. Check credentials, firewall rules and approved target ranges.")
        result = send_inventory(args.api_url, token, devices)
        print("EffDesk SNMP discovery complete: {discovered} devices ({created} created, {updated} updated).".format(**result))
    except (ValueError, OSError, json.JSONDecodeError, urllib.error.URLError, RuntimeError) as exc:
        print("EffDesk SNMP discovery failed: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
