import json, os
from collections import Counter

BASELINE_DIR = '/tmp/xavira-batch3-runs/batch3_run_1790873841985'
TREATMENT_DIR = '/tmp/xavira-batch3-runs/adaptive_run_1790879512618'

BASE_ART = os.path.join(BASELINE_DIR, 'artifacts')
TREAT_ART = os.path.join(TREATMENT_DIR, 'artifacts')

# Load all artifacts from both runs
baseline = {}
for fname in os.listdir(BASE_ART):
    data = json.loads(open(os.path.join(BASE_ART, fname)).read())
    baseline[data['url'].lower()] = data

treatment = {}
for fname in os.listdir(TREAT_ART):
    data = json.loads(open(os.path.join(TREAT_ART, fname)).read())
    treatment[data['url'].lower()] = data

print('=' * 100)
print('BASELINE vs ADAPTIVE — CONTROLLED COMPARISON REPORT')
print(f'Baseline:    {len(baseline)} companies ({BASELINE_DIR})')
print(f'Treatment:   {len(treatment)} companies ({TREATMENT_DIR})')
print('=' * 100)

# ─── Reconciliation ───
print()
print('1. RECONCILIATION')
print('-' * 50)
bm = json.loads(open(os.path.join(BASELINE_DIR, 'manifest.json')).read())
tm = json.loads(open(os.path.join(TREATMENT_DIR, 'manifest.json')).read())
print(f'  Baseline:  completed={bm["completed_count"]} failed={bm["failed_count"]} timed_out={bm["timed_out_count"]} skipped={bm["skipped_count"]} (target={bm["target_count"]})')
print(f'  Treatment: completed={tm["completed_count"]} failed={tm["failed_count"]} timed_out={tm["timed_out_count"]} skipped={tm["skipped_count"]} (target={tm["target_count"]})')
print(f'  Baseline reconciliation:  {bm["completed_count"]+bm["failed_count"]+bm["timed_out_count"]+bm["skipped_count"]} == {bm["target_count"]} -> {"PASS" if bm["completed_count"]+bm["failed_count"]+bm["timed_out_count"]+bm["skipped_count"]==bm["target_count"] else "FAIL"}')
print(f'  Treatment reconciliation: {tm["completed_count"]+tm["failed_count"]+tm["timed_out_count"]+tm["skipped_count"]} == {tm["target_count"]} -> {"PASS" if tm["completed_count"]+tm["failed_count"]+tm["timed_out_count"]+tm["skipped_count"]==tm["target_count"] else "FAIL"}')

# ─── Per-company comparison ───
print()
print('2. PER-COMPANY COMPARISON')
print('-' * 50)

categories = {
    'unchanged': [],           # decision same, evidence same, subs same
    'added_evidence': [],      # evidence count increased, decision unchanged
    'new_surface': [],         # new subdomain discovered
    'new_verification_target': [],  # new evidence that could be a verification target
    'decision_changed': [],    # decision changed
    'new_outreach': [],        # baseline not OUTREACH_READY, treatment OUTREACH_READY
    'evidence_added_decision_unchanged': [],  # case 7
    'false_inference': [],     # case 8
}

adaptive_active = []  # companies where adaptive pivots occurred
for url in sorted(set(baseline.keys()) & set(treatment.keys())):
    b = baseline[url]
    t = treatment[url]

    b_dec = b.get('decision', '')
    t_dec = t.get('decision', '')
    b_ev = b.get('evidence_count') or len(b.get('evidence', []))
    t_ev = t.get('evidence_count') or len(t.get('evidence', []))
    b_subs = b.get('discovered_subdomains', [])
    t_subs = t.get('discovered_subdomains', [])
    b_signals = b.get('signals', [])
    t_signals = t.get('signals', [])

    # Check adaptive activity
    ai = t.get('adaptive_investigation', {})
    ai_agg = ai.get('aggregate', {})
    pivots = ai_agg.get('pivots_executed', 0)

    if pivots > 0:
        adaptive_active.append((b, t, pivots))

    dec_changed = b_dec != t_dec
    ev_changed = t_ev != b_ev
    subs_changed = t_subs != b_subs
    b_outreach = (b_dec == 'OUTREACH_READY' and (b.get('finding_type','') or '').startswith('OBSERVED'))
    t_outreach = (t_dec == 'OUTREACH_READY' and (t.get('finding_type','') or '').startswith('OBSERVED'))

    if dec_changed:
        categories['decision_changed'].append((b, t))
    if t_outreach and not b_outreach:
        categories['new_outreach'].append((b, t))
    if ev_changed and t_ev > b_ev and not dec_changed:
        categories['added_evidence'].append((b, t))
    if ev_changed and t_ev > b_ev and not dec_changed:
        categories['evidence_added_decision_unchanged'].append((b, t))
    if subs_changed and len(set(t_subs) - set(b_subs)) > 0:
        categories['new_surface'].append((b, t))
    if dec_changed and not t_outreach and b_outreach:
        # Outreach lost — need to check if false inference
        categories['false_inference'].append((b, t))

    # Check for new verification targets
    t_records = ai.get('records', [])
    for r in t_records:
        if r.get('new_target_ids') and len(r['new_target_ids']) > 0:
            categories['new_verification_target'].append((b, t, r))
            break

    # If nothing changed, it's unchanged
    if not dec_changed and not ev_changed and not subs_changed:
        categories['unchanged'].append((b, t))

# Print category counts
print()
c = len(categories['unchanged'])
print(f'  1. Unchanged:                          {c}')
c = len(categories['added_evidence'])
print(f'  2. Adaptive added evidence:             {c}')
c = len(categories['new_surface'])
print(f'  3. Adaptive found new public surface:   {c}')
c = len(categories['new_verification_target'])
print(f'  4. Adaptive created new verification:   {c}')
c = len(categories['decision_changed'])
print(f'  5. Decision changed:                   {c}')
c = len(categories['new_outreach'])
print(f'  6. New OUTREACH_READY (not in baseline): {c}')
c = len(categories['evidence_added_decision_unchanged'])
print(f'  7. Evidence added, decision unchanged:  {c}')
c = len(categories['false_inference'])
print(f'  8. False/unsupported inference:         {c}')

total_companies = len(baseline)
print(f'\n  Total companies compared: {total_companies}')
print(f'  Companies with adaptive activity (pivots_executed > 0): {len(adaptive_active)}')

# ─── Detailed per-company diffs ───
print()
print('3. DETAILED PER-COMPANY DIFFS')
print('-' * 50)
for url in sorted(set(baseline.keys()) & set(treatment.keys())):
    b = baseline[url]
    t = treatment[url]
    b_dec = b.get('decision', '')
    t_dec = t.get('decision', '')
    b_ev = b.get('evidence_count') or len(b.get('evidence', []))
    t_ev = t.get('evidence_count') or len(t.get('evidence', []))
    b_subs = b.get('discovered_subdomains', [])
    t_subs = t.get('discovered_subdomains', [])
    ai = t.get('adaptive_investigation', {})
    ai_agg = ai.get('aggregate', {})
    pivots = ai_agg.get('pivots_executed', 0)
    new_ev = ai_agg.get('new_evidence_found', 0)

    changes = []
    if b_dec != t_dec: changes.append(f'decision {b_dec}→{t_dec}')
    if t_ev != b_ev: changes.append(f'evidence {b_ev}→{t_ev}')
    if b_subs != t_subs:
        b_set = set(b_subs)
        t_set = set(t_subs)
        added = t_set - b_set
        removed = b_set - t_set
        if added: changes.append(f'subs_added={sorted(added)}')
        if removed: changes.append(f'subs_removed={sorted(removed)}')
    if pivots > 0: changes.append(f'adaptive_pivots={pivots} new_evidence={new_ev}')

    if changes:
        print(f'  {b["company"]}: {", ".join(changes)}')

# ─── Adaptive investigation details ───
print()
print('4. ADAPTIVE INVESTIGATION DETAILS')
print('-' * 50)
for b, t, pivots in adaptive_active:
    ai = t.get('adaptive_investigation', {})
    agg = ai.get('aggregate', {})
    print(f'\n  Company: {t["company"]} ({t["url"]})')
    print(f'  Baseline decision: {b.get("decision")} | Treatment decision: {t.get("decision")}')
    print(f'  Pivots executed: {pivots}')
    print(f'  Aggregate: {json.dumps(agg)}')
    for r in ai.get('records', []):
        if r['outcome'] in ('PIVOT_SUGGESTED', 'PIVOT_EXECUTED', 'ALTERNATE_SURFACE_FOUND', 'NEW_EVIDENCE_FOUND', 'NEW_VERIFICATION_TARGET', 'VERIFIED', 'NO_USEFUL_RESULT', 'RESEARCH_MORE', 'INCONCLUSIVE'):
            print(f'  Record: {r["investigation_id"]} {r["outcome"]} {r["initial_boundary_classification"]}')
            print(f'    pivot_action: {r["pivot_action"]}')
            print(f'    candidate_surfaces: {r["candidate_public_surfaces"]}')
            print(f'    discovered_surfaces: {r["discovered_public_surfaces"]}')
            print(f'    rejected_surfaces: {r["rejected_surfaces"]}')
            print(f'    rejection_reasons: {r["rejection_reasons"]}')
            print(f'    new_evidence_ids: {r["new_evidence_ids"]}')
            print(f'    new_target_ids: {r["new_target_ids"]}')
            print(f'    attribution_confidence: {r["attribution_confidence"]}')
            print(f'    verification_result: {r["verification_result"]}')
            if r.get('evidence'):
                for ev in r['evidence'][:3]:
                    print(f'    evidence: {ev.get("id","?")} url={ev.get("public_url","?")} status={ev.get("status")} origin={ev.get("evidence_origin")}')

# ─── Aggregate metrics ───
print()
print('5. AGGREGATE METRICS')
print('-' * 50)

t_agg = tm.get('adaptive_pivots_suggested', 0)
t_exec = tm.get('adaptive_pivots_executed', 0)
t_surfaces = tm.get('adaptive_surfaces_found', 0)
t_new_ev = tm.get('adaptive_new_evidence', 0)
t_new_targets = tm.get('adaptive_new_verification_targets', 0) or 0
t_verified = tm.get('adaptive_verified', 0)
t_no_useful = tm.get('adaptive_no_useful', 0)

# Count companies with adaptive activity
companies_with_pivots = len(adaptive_active)
total_companies = len(baseline)

# Companies where decision changed
dec_changed_count = len(categories['decision_changed'])
# Companies where new OUTREACH_READY was found
new_outreach_count = len(categories['new_outreach'])
# Companies where evidence was added
evidence_added_count = len(categories['evidence_added_decision_unchanged'])

def pct(num, den, label):
    if den == 0:
        print(f'  {label}: {num}/{den} = NOT_AVAILABLE (denominator 0)')
    else:
        print(f'  {label}: {num}/{den} = {num/den*100:.1f}%')

pct(companies_with_pivots, total_companies, 'adaptive_execution_rate')
pct(t_exec, t_agg if t_agg > 0 else 1, 'pivot_execution_rate (executed/suggested)')
pct(t_surfaces, t_exec if t_exec > 0 else 1, 'alternate_surface_discovery_rate')
pct(t_new_ev, t_exec if t_exec > 0 else 1, 'new_evidence_rate (per pivot)')
pct(t_new_targets, t_exec if t_exec > 0 else 1, 'new_target_rate (per pivot)')
pct(t_verified, t_new_targets if t_new_targets > 0 else 1, 'adaptive_verification_rate')
pct(dec_changed_count, total_companies, 'adaptive_decision_change_rate')
pct(new_outreach_count, total_companies, 'adaptive_outreach_delta (net new OUTREACH_READY)')

print()
print(f'  Baseline decisions:  {bm["decisions"]}')
print(f'  Treatment decisions: {tm["decisions"]}')
print(f'  Baseline evidence:   {bm["total_evidence_records"]}')
print(f'  Treatment evidence:  {tm["total_evidence_records"]}')
print(f'  Baseline subdomains: {bm["total_subdomains_discovered"]}')
print(f'  Treatment subdomains: {tm["total_subdomains_discovered"]}')

# ─── Boundary classifications ───
print()
print('6. BOUNDARY CLASSIFICATIONS (from adaptive records)')
print('-' * 50)
boundary_counts = Counter()
for b, t, pivots in adaptive_active:
    ai = t.get('adaptive_investigation', {})
    for r in ai.get('records', []):
        bc = r.get('initial_boundary_classification', 'UNKNOWN')
        boundary_counts[bc] += 1
for bc, count in sorted(boundary_counts.items()):
    print(f'  {bc}: {count}')

# ─── Outcome values ───
print()
print('7. OUTCOME VALUES (from adaptive records)')
print('-' * 50)
outcome_counts = Counter()
for b, t, pivots in adaptive_active:
    ai = t.get('adaptive_investigation', {})
    for r in ai.get('records', []):
        outcome_counts[r.get('outcome','UNKNOWN')] += 1
for oc, count in sorted(outcome_counts.items()):
    print(f'  {oc}: {count}')

print()
print('8. RATE-LIMITED URLS (distinct from EMPTY)')
print('-' * 50)
base_rl = sum(len(b.get('rate_limited', [])) for b in baseline.values())
treat_rl = sum(len(t.get('rate_limited', [])) for t in treatment.values())
print(f'  Baseline rate-limited URLs: {base_rl}')
print(f'  Treatment rate-limited URLs: {treat_rl}')

print()
print('9. ARTIFACT INVENTORY')
print('-' * 50)
print(f'  Baseline artifacts:  {len(baseline)}')
print(f'  Treatment artifacts: {len(treatment)}')
baseline_with_ai = sum(1 for b in baseline.values() if b.get('adaptive_investigation'))
treatment_with_ai = sum(1 for t in treatment.values() if t.get('adaptive_investigation'))
print(f'  Baseline with adaptive_investigation field: {baseline_with_ai} (expect 0 — field did not exist)')
print(f'  Treatment with adaptive_investigation field: {treatment_with_ai} (expect 50)')
# Check backward compat
baseline_no_ai = sum(1 for b in baseline.values() if not b.get('adaptive_investigation'))
print(f'  Baseline artifacts without adaptive field (backward compat): {baseline_no_ai}')
