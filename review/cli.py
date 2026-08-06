"""
Review queue CLI. The human gate between agent output and the knowledge base.

Usage:
  python -m review.cli list
  python -m review.cli show 3
  python -m review.cli approve 3 --tier B --reviewer paulo
  python -m review.cli approve 3 --tier B --reviewer paulo --title "..." --body "..."
  python -m review.cli reject 3 --reviewer paulo --note "source is agent marketing"
"""
import argparse

from sqlalchemy import select

from db.models import Finding
from db.session import SessionLocal, init_db
from kb.store import promote_finding, reject_finding, pending_findings


def cmd_list(s):
    rows = pending_findings(s)
    if not rows:
        print("Review queue empty.")
        return
    for f in rows:
        print(f"[{f.id}] ({f.category}/{f.proposed_tier}) {f.title}")
        print(f"      src: {f.source_name or '-'}  task#{f.task_id}")


def cmd_show(s, fid):
    f = s.get(Finding, fid)
    if not f:
        print(f"No finding #{fid}")
        return
    print(f"#{f.id}  status={f.review_status}  category={f.category}  proposed_tier={f.proposed_tier}")
    print(f"title : {f.title}")
    print(f"source: {f.source_name}  {f.source_url or ''}")
    print(f"task  : #{f.task_id} - {f.task.question}")
    print("-" * 60)
    print(f.body)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sp = sub.add_parser("show"); sp.add_argument("id", type=int)
    ap = sub.add_parser("approve")
    ap.add_argument("id", type=int)
    ap.add_argument("--tier", required=True, choices=list("ABCD"))
    ap.add_argument("--reviewer", required=True)
    ap.add_argument("--title"); ap.add_argument("--body")
    rp = sub.add_parser("reject")
    rp.add_argument("id", type=int)
    rp.add_argument("--reviewer", required=True)
    rp.add_argument("--note", required=True)
    args = p.parse_args()

    init_db()
    with SessionLocal() as s:
        if args.cmd == "list":
            cmd_list(s)
        elif args.cmd == "show":
            cmd_show(s, args.id)
        elif args.cmd == "approve":
            f = s.get(Finding, args.id)
            if not f or f.review_status != "pending":
                print("Not found or already reviewed."); return
            node = promote_finding(s, f, args.tier, args.reviewer,
                                   edited_title=args.title, edited_body=args.body)
            print(f"Promoted finding #{f.id} -> node #{node.id} (tier {args.tier}, verified)")
        elif args.cmd == "reject":
            f = s.get(Finding, args.id)
            if not f or f.review_status != "pending":
                print("Not found or already reviewed."); return
            reject_finding(s, f, args.reviewer, args.note)
            print(f"Rejected finding #{f.id}")


if __name__ == "__main__":
    main()
