import { ALL_COMPANIES_RESEARCH_DATA } from './src/data/allCompaniesResearch.ts';
import { TargetQualificationEngine } from './src/server/targetQualificationEngine.ts';
import { SubjectLineService } from './src/server/subjectLineService.ts';

const experimentTargets = ALL_COMPANIES_RESEARCH_DATA.slice(0, 65);

const auditResults = experimentTargets.map(company => {
  const q = TargetQualificationEngine.qualifyTarget(company);
  const subjectGen = SubjectLineService.generateSubjects({
    company: q.company,
    evidenceText: q.evidence,
    publishedAt: q.date,
    verificationStatus: q.source && q.evidence ? 'VERIFIED' : 'UNVERIFIED',
    signalType: q.signal
  });

  return {
    company: q.company,
    person: q.person,
    role: q.role,
    signalType: q.signal,
    sourceUrl: q.source || 'NONE',
    publishedDate: q.date || 'NONE',
    signalAge: q.age === 9999 ? 'N/A' : `${q.age}d`,
    evidence: q.evidence || 'NONE (No verified source found)',
    confidence: q.confidence,
    score: q.score,
    priority: q.priority,
    subject: subjectGen.selectedSubject || 'SUBJECT_BLOCKED_NO_VERIFIED_SIGNAL',
    angle: q.angle || 'General Systems Inquiry',
    identityStatus: q.identityVerified ? 'VERIFIED' : 'MISMATCH / UNVERIFIED',
    emailStatus: q.allGatesPassed ? 'ELIGIBLE' : q.status,
    blockReason: q.blockReason || (subjectGen.status === 'BLOCKED' ? subjectGen.rationale : 'NONE')
  };
});

console.log(JSON.stringify(auditResults, null, 2));
