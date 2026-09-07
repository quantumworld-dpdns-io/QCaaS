"""Operational CLI: `qcaas <command>` (or `python -m qcaas.cli`)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import get_settings


def cmd_create_key(args: argparse.Namespace) -> int:
    from .auth.api_key import create_customer
    from .storage.db import init_db, session_factory

    settings = get_settings()
    init_db(settings)
    with session_factory()() as s:
        customer, key = create_customer(
            s, args.name, settings.api_key_salt, args.plan, args.retention_days
        )
        s.commit()
        print(
            json.dumps(
                {"customer_id": customer.id, "name": customer.name, "api_key": key}, indent=2
            )
        )
    return 0


def cmd_list_customers(_: argparse.Namespace) -> int:
    from sqlalchemy import select

    from .storage.db import init_db, session_factory
    from .storage.models import Customer

    init_db(get_settings())
    with session_factory()() as s:
        for c in s.scalars(select(Customer)):
            print(
                f"{c.id}  {c.key_prefix}…  plan={c.plan} retention={c.retention_days}d "
                f"active={c.active}  {c.name}"
            )
    return 0


def cmd_export_openapi(args: argparse.Namespace) -> int:
    from .main import create_app

    spec = create_app().openapi()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(spec, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        current = out.read_text(encoding="utf-8") if out.exists() else ""
        if current != text:
            print(f"{out} is stale; run `qcaas export-openapi`", file=sys.stderr)
            return 1
        print(f"{out} is up to date")
        return 0
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out}")
    return 0


def cmd_export_pricing(args: argparse.Namespace) -> int:
    from .core.cost.pricing import get_pricing
    from .core.cost.table import pricing_csv

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(pricing_csv(get_pricing(get_settings().pricing_path)), encoding="utf-8")
    print(f"wrote {out}")
    return 0


def cmd_purge(_: argparse.Namespace) -> int:
    from .storage.db import init_db, session_factory
    from .storage.retention import purge_expired

    init_db(get_settings())
    with session_factory()() as s:
        n = purge_expired(s)
        s.commit()
    print(f"purged payloads of {n} expired job(s)")
    return 0


def cmd_warm(args: argparse.Namespace) -> int:
    from .core.backends.ibm import resolve_backend

    b = resolve_backend(args.backend or get_settings().default_backend)
    print(f"{b.name}: {b.num_qubits} qubits")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="qcaas")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("create-key", help="create a customer and print its API key")
    c.add_argument("--name", required=True)
    c.add_argument("--plan", default="payg", choices=["payg", "flex", "premium"])
    c.add_argument("--retention-days", type=int, default=30)
    c.set_defaults(fn=cmd_create_key)

    sub.add_parser("list-customers", help="list customers").set_defaults(fn=cmd_list_customers)

    e = sub.add_parser("export-openapi", help="write docs/openapi.json (or --check for CI)")
    e.add_argument("--out", default="docs/openapi.json")
    e.add_argument("--check", action="store_true")
    e.set_defaults(fn=cmd_export_openapi)

    pr = sub.add_parser("export-pricing", help="write docs/pricing.csv")
    pr.add_argument("--out", default="docs/pricing.csv")
    pr.set_defaults(fn=cmd_export_pricing)

    sub.add_parser("purge-expired", help="blank payloads past retention").set_defaults(fn=cmd_purge)

    w = sub.add_parser("warm", help="load a backend (offline: fake) to check availability")
    w.add_argument("backend", nargs="?")
    w.set_defaults(fn=cmd_warm)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    raise SystemExit(main())
