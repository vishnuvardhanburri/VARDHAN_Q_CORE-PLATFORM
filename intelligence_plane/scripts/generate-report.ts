import json, os
from collections import Counter

RUN_DIR = '/tmp/vardhan-batch3-runs/batch3_run_1790873841985';
ART_DIR = os.path.join(RUN_DIR, 'artifacts');

current = {};
for fname in sorted(os.listdir(ART_DIR)):
    data = json.loads(open(os.path.join(ART_DIR, fname)).read());
    current[data['url'].lower()] = data;

try:
    prev = json.loads(open('/tmp/vardhan-batch3-results.json').read());
    prev_by_url = {r['url'].lower(): r for r in prev};
except:
    prev = [];
    prev_by_url = {};

print('=' * 80);
print('FINAL REPORT: COMPLETE 50-COMPANY BATCH 3');
print('=' * 80);

print();
print('A. RECONCILIATION');
print('-' * 40);
total = len(current);
completed = sum(1 for a in current.values() if a['terminal_state']['state'] == 'COMPLETED');
failed = sum(1 for a in current.values() if a['terminal_state']['state'] == 'FAILED');
timed_out = sum(1 for a in current.values() if a['terminal_state']['state'] == 'TIMED_OUT');
skipped = sum(1 for a in current.values() if a['terminal_state']['state'] == 'SKIPPED');
print(f'  Total targets:   {total}');
print(f'  Completed:       {completed}');
print(f'  Failed:          {failed}');
print(f'  Timed out:       {timed_out}');
print(f'  Skipped:         {skipped}');
print(f'  Sum:             {completed+failed+timed_out+skipped}');
status = 'PASS' if completed+failed+timed_out+skipped == total == 50 else 'FAIL';
print(f'  Reconciliation:  {status}');

print();
print('B. DECISION DISTRIBUTION');
print('-' * 40);
decisions = Counter(a.get('decision','') for a in current.values());
for d, c in sorted(decisions.items()):
    print(f'  {d:20s} {c:3d}');

print();
print('C. REAL PROSPECT CANDIDATES');
print('-' * 40);
candidates = [a for a in current.values() if a.get('decision') == 'OUTREACH_READY' and a.get('finding_type','').startswith('OBSERVED')];
for c in sorted(candidates, key=lambda x: x['company']):
    print(f'  {c["company"]} ({c["url"]})');
    print(f'    Finding: {c["finding_type"]}, Confidence: {c["finding_confidence"]}');
    print(f'    Evidence: {len(c.get("evidence",[]))} records, Subdomains: {len(c.get("discovered_subdomains",[]))}');
    if c.get('proof_chain'):
        pc = c['proof_chain'];
        print(f'    Proof chain: {len(pc["evidence_ids"])} evidence IDs, {len(pc.get("evidence_pack",[]))} evidence records');
    card = c.get('finding_card') or '';
    print(f'    Finding card: present ({len(card)} chars)');
    print();

print();
print('D. COMPARISON WITH PREVIOUS BATCH 3 RUN');
print('-' * 40);
prev_candidates = sum(1 for r in prev if r.get('decision') == 'OUTREACH_READY');
curr_candidates = sum(1 for a in current.values() if a.get('decision') == 'OUTREACH_READY');
print(f'  Previous run: {len(prev)} companies, {prev_candidates} OUTREACH_READY');
print(f'  Current run:  {len(current)} companies, {curr_candidates} OUTREACH_READY');
print();

both = set(prev_by_url.keys()) & set(current.keys());
print(f'  Companies in BOTH runs: {len(both)}');
print();
print('  Material differences (decision/finding/evidence/subs changes):');
for url in sorted(both):
    p = prev_by_url[url];
    c = current[url];
    p_dec = p.get('decision','');
    c_dec = c.get('decision','');
    p_find = p.get('finding') or p.get('finding_type') or 'NONE';
    c_find = c.get('finding_type') or 'NONE';
    p_ev = p.get('evidence_count') or len(p.get('evidence',[])) or 0;
    c_ev = len(c.get('evidence',[]));
    p_subs_raw = p.get('discovered_subdomains') or p.get('subdomains') or 0;
    if isinstance(p_subs_raw, list):
        p_subs = len(p_subs_raw);
    else:
        p_subs = p_subs_raw;
    c_subs = len(c.get('discovered_subdomains',[]));
    changes = [];
    if p_dec != c_dec: changes.append(f'decision {p_dec}->{c_dec}');
    if p_find != c_find: changes.append(f'finding {p_find}->{c_find}');
    if p_ev != c_ev: changes.append(f'evidence {p_ev}->{c_ev}');
    if p_subs != c_subs: changes.append(f'subs {p_subs}->{c_subs}');
    if changes:
        print(f'    {url}: {", ".join(changes)}');

not_in_prev = set(current.keys()) - set(prev_by_url.keys());
if not_in_prev:
    print(f'\n  In current but not previous: {len(not_in_prev)}');
    for u in sorted(not_in_prev):
        c = current[u];
        print(f'    {c["company"]}: decision={c.get("decision")}, finding={c.get("finding_type")}');

print();
print('E. SURFACE METRICS');
print('-' * 40);
all_subs = set();
total_ev = 0;
for a in current.values():
    for s in a.get('discovered_subdomains', []):
        all_subs.add(s);
    total_ev += len(a.get('evidence', []));
print(f'  Total evidence records: {total_ev}');
print(f'  Total unique subdomains: {len(all_subs)}');
companies_with_subs = sum(1 for a in current.values() if len(a.get('discovered_subdomains',[])) > 0);
companies_rate_limited = sum(1 for a in current.values() if len(a.get('rate_limited',[])) > 0);
print(f'  Companies with subdomains: {companies_with_subs}');
print(f'  Companies with rate-limited URLs: {companies_rate_limited}');

print();
print('F. PROVIDER STATUS');
print('-' * 40);
provider_stats = {};
for a in current.values():
    for p, s in a.get('provider_statuses', {}).items():
        provider_stats.setdefault(p, Counter())[s] += 1;
for p, stats in sorted(provider_stats.items()):
    print(f'  {p}: {dict(stats)}');

print();
print('G. ARTIFACT INVENTORY');
print('-' * 40);
artifact_count = len(os.listdir(ART_DIR));
print(f'  Run directory: {RUN_DIR}');
print(f'  Artifacts:     {artifact_count} files (one per company)');
print(f'  Manifest:      {os.path.join(RUN_DIR, "manifest.json")}');
print(f'  Summary:       {os.path.join(RUN_DIR, "results_summary.json")}');
all_have_pc = all(c.get('proof_chain') for c in candidates);
all_have_card = all(c.get('finding_card') for c in candidates);
print(f'  All OUTREACH_READY have proof chains: {all_have_pc}');
print(f'  All OUTREACH_READY have finding cards: {all_have_card}');
