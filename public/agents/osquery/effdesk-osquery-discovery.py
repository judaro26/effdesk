#!/usr/bin/env python3
"""EffDesk osquery inventory bridge for macOS and Linux.

Requires Python 3.8+ and the osqueryi executable. Read-only, local inventory only.
"""
import argparse
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import urllib.error
import urllib.request
import socket


def parse_args():
    parser = argparse.ArgumentParser(description="Send a local osquery inventory snapshot to EffDesk.")
    parser.add_argument("--token", help="One-time EffDesk discovery enrollment token.")
    parser.add_argument("--token-file", help="Path to a token file readable only by the service account (chmod 600).")
    parser.add_argument("--api-url", default="https://app.effdesk.com/api/cmdb-agent")
    parser.add_argument("--osqueryi", default="osqueryi", help="Path to osqueryi executable.")
    parser.add_argument("--timeout", type=int, default=30)
    return parser.parse_args()


def read_token(args):
    if args.token and args.token_file:
        raise ValueError("Use either --token or --token-file, not both.")
    if args.token_file:
        path = os.path.abspath(args.token_file)
        if os.name == "posix":
            mode = stat.S_IMODE(os.stat(path).st_mode)
            if mode & 0o077:
                raise ValueError("Token file permissions are too open. Run chmod 600 on the token file.")
        with open(path, "r", encoding="utf-8") as handle:
            token = handle.read().strip()
    else:
        token = (args.token or "").strip()
    if len(token) < 80 or len(token) > 512:
        raise ValueError("A valid EffDesk enrollment token is required.")
    return token


def run_query(binary, sql, timeout):
    result = subprocess.run(
        [binary, "--json", sql],
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError("osquery query failed")
    rows = json.loads(result.stdout or "[]")
    if not isinstance(rows, list):
        raise RuntimeError("Unexpected osquery result")
    return rows


def first(rows):
    return rows[0] if rows else {}


def main():
    args = parse_args()
    if not args.api_url.startswith("https://"):
        raise ValueError("EffDesk API URL must use HTTPS.")
    token = read_token(args)
    binary = shutil.which(args.osqueryi) or (args.osqueryi if os.path.isfile(args.osqueryi) else None)
    if not binary:
        raise ValueError("osqueryi was not found. Install osquery and ensure osqueryi is on PATH.")

    system = platform.system().lower()
    if system == "darwin":
        os_platform = "darwin"
    elif system == "linux":
        os_platform = "linux"
    else:
        raise ValueError("This osquery bridge currently supports macOS and Linux. Use the native PowerShell agent on Windows.")

    info = first(run_query(binary, "SELECT hostname, hardware_vendor, hardware_model, hardware_serial FROM system_info;", args.timeout))
    version = first(run_query(binary, "SELECT name, version FROM os_version;", args.timeout))
    hostname = str(info.get("hostname") or socket.gethostname()).strip()
    serial = str(info.get("hardware_serial") or "").strip()
    if not serial or serial.lower() in ("unknown", "none", "to be filled by o.e.m."):
        serial = "NO-SERIAL-" + hostname.upper()

    software = []
    software_complete = True
    if os_platform == "darwin":
        try:
            rows = run_query(binary, "SELECT name, bundle_identifier, version FROM apps;", args.timeout)
            software = [
                {"name": str(row.get("name") or "").strip(),
                 "publisher": str(row.get("bundle_identifier") or "").strip(),
                 "version": str(row.get("version") or "").strip()}
                for row in rows if str(row.get("name") or "").strip()
            ]
        except Exception:
            software_complete = False
    else:
        successful_package_tables = 0
        for table in ("deb_packages", "rpm_packages"):
            try:
                rows = run_query(binary, "SELECT name, version, source FROM " + table + ";", args.timeout)
                successful_package_tables += 1
                software.extend(
                    {"name": str(row.get("name") or "").strip(),
                     "publisher": str(row.get("source") or "").strip(),
                     "version": str(row.get("version") or "").strip()}
                    for row in rows if str(row.get("name") or "").strip()
                )
            except Exception:
                # Most Linux distributions use one of these package databases.
                continue
        software_complete = successful_package_tables > 0

    unique = {}
    for app in software:
        key = (app["name"].casefold(), app["version"])
        unique.setdefault(key, app)
    software = list(unique.values())
    if len(software) > 500:
        software_complete = False
        software = software[:500]

    payload = {
        "platform": os_platform,
        "hostname": hostname,
        "manufacturer": str(info.get("hardware_vendor") or "").strip(),
        "model": str(info.get("hardware_model") or "").strip(),
        "serial": serial,
        "os": str(version.get("name") or platform.system()).strip(),
        "osVersion": str(version.get("version") or platform.release()).strip(),
        "software": software,
        "softwareComplete": software_complete,
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        args.api_url,
        data=body,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json", "Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise ValueError("EffDesk rejected this enrollment token. Ask a workspace administrator to issue a new token.")
        if error.code == 429:
            raise ValueError("EffDesk rate-limited this device. Wait before retrying.")
        raise ValueError("EffDesk discovery failed with HTTP " + str(error.code) + ".")
    if not result.get("ok"):
        raise ValueError("EffDesk did not accept the inventory snapshot.")
    print("EffDesk discovery succeeded: " + str(result.get("softwareCount", 0)) + " installed applications reported.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("EffDesk discovery error: " + str(error), file=sys.stderr)
        sys.exit(1)
