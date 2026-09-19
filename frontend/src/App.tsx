import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Check, CheckCircle2, Circle, FileCheck2, FileText, FolderOpen, LoaderCircle, MessageCircle, PencilLine, Plane, RefreshCw, ScanLine, Send, ShieldCheck, Sparkles, TriangleAlert, UploadCloud, X } from "lucide-react";
import { evaluate, explainIssue, extractDocument, extractIntent, getInstitution, getInstitutions, reverify, type CanonicalProfile, type ExtractedDocument, type InstitutionConfig, type Issue, type ReconciliationContext, type Status, type SupportingDocumentType, type VerificationResult } from "./api";

const DEMO_MESSAGE = "I need ₹3 lakh for 24 months. I earn ₹60,000 and have an EMI of ₹7,000.";

function formatMoney(value: number | string | null | undefined) {
  if (value == null) return "Missing";
  if (typeof value === "string") return value;
  return `₹${value.toLocaleString("en-IN")}`;
}
function formatCheckValue(check: { id: string; status: Status }, profile: CanonicalProfile) {
  if (check.status === "MISSING") return "Missing";
  if (check.id === "loan_amount") return formatMoney(profile.loan_amount);
  if (check.id === "tenure_months") return profile.tenure_months ? `${profile.tenure_months} months` : "Missing";
  if (check.id === "monthly_income") return formatMoney(profile.income.gross_monthly);
  if (check.id === "employment_type") return profile.employment.type === "salaried" ? "Salaried" : profile.employment.type ?? "Missing";
  return "Provided";
}
function statusLabel(status: Status) { return status === "NEEDS_CLARIFICATION" ? "Needs clarification" : status[0] + status.slice(1).toLowerCase(); }
function humanizeTechnicalTerms(value: string) { return value.replace(/income\.gross_monthly/g, "monthly income").replace(/income\.net_monthly/g, "take-home income").replace(/employment\.employer/g, "employer").replace(/_/g, " "); }

function App() {
  const [message, setMessage] = useState(DEMO_MESSAGE);
  const [profile, setProfile] = useState<CanonicalProfile | null>(null);
  const [institution, setInstitution] = useState<InstitutionConfig | null>(null);
  const [institutionCatalog, setInstitutionCatalog] = useState<InstitutionConfig[]>([]);
  const [documents, setDocuments] = useState<ExtractedDocument[]>([]);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [explanation, setExplanation] = useState("");
  const [screen, setScreen] = useState<"landing" | "onboarding" | "understanding" | "preparation">("landing");
  const [chatPhase, setChatPhase] = useState<"empty" | "understood">("empty");
  const [loading, setLoading] = useState<"intent" | "document" | "explanation" | "reverify" | "evaluation" | null>(null);
  const [error, setError] = useState("");
  const [documentType, setDocumentType] = useState<SupportingDocumentType>("salary_slip");
  const [correction, setCorrection] = useState("");
  const [selectedExplanation, setSelectedExplanation] = useState<"salary_revision" | "gross_net_difference" | "recent_job_change" | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [reconciliationNotice, setReconciliationNotice] = useState(false);

  async function startPreFlight() {
    if (!message.trim()) return;
    setLoading("intent"); setError(""); setProfile(null); setResult(null); setScreen("understanding");
    try {
      const [intent, config, institutions] = await Promise.all([extractIntent(message), getInstitution(), getInstitutions()]);
      const evaluated = await evaluate(intent.profile, config, []);
      setProfile(intent.profile); setInstitution(config); setInstitutionCatalog(institutions); setResult(evaluated); setIssue(evaluated.issues[0] ?? null);
    } catch { setError("We couldn't fully understand your application."); }
    finally { setLoading(null); }
  }

  async function changeInstitution(nextInstitution: InstitutionConfig) {
    if (!profile) return;
    setLoading("evaluation"); setError("");
    try {
      const evaluated = await evaluate(profile, nextInstitution, documents);
      setInstitution(nextInstitution); setResult(evaluated); setIssue(evaluated.issues[0] ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not switch institutions."); }
    finally { setLoading(null); }
  }

  async function continueFromChat() {
    if (!profile || !institution) return;
    setLoading("evaluation"); setError("");
    try {
      const evaluated = await evaluate(profile, institution, documents);
      setResult(evaluated); setScreen("preparation");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not open your preparation view."); }
    finally { setLoading(null); }
  }

  async function handleUpload(file: File, reconciliationContext?: ReconciliationContext): Promise<boolean> {
    if (!profile || !institution) return false;
    setLoading("document"); setError(""); setReconciliationNotice(false);
    try {
      const extracted = await extractDocument(file, documentType);
      const nextDocuments = [...documents, extracted.document];
      const evaluated = await evaluate(profile, institution, nextDocuments, reconciliationContext);
      setDocuments(nextDocuments); setResult(evaluated);
      const nextIssue = evaluated.issues[0] ?? null; setIssue(nextIssue);
      let finalResult: VerificationResult;
      if (nextIssue) {
        setLoading("explanation");
        const response = await explainIssue(nextIssue);
        setExplanation(response.explanation);
        const revalidated = await reverify(profile, institution, nextDocuments, reconciliationContext);
        finalResult = revalidated; setResult(revalidated); setIssue(revalidated.issues[0] ?? null); setExplanation(response.explanation);
      } else {
        const revalidated = await reverify(profile, institution, nextDocuments, reconciliationContext);
        finalResult = revalidated; setResult(revalidated); setIssue(revalidated.issues[0] ?? null); setExplanation("");
      }
      if (finalResult.reconciliation?.status === "VERIFIED" && finalResult.issues.length === 0) {
        setReconciliationNotice(true);
        window.setTimeout(() => setReconciliationNotice(false), 1100);
      }
      return true;
    } catch { setError("Couldn't upload the supporting document. Please choose another document."); return false; }
    finally { setLoading(null); }
  }

  async function confirmCorrection() {
    if (!profile || !institution || !issue || !correction) return;
    setLoading("reverify"); setError("");
    try {
      const nextProfile = { ...profile, income: { ...profile.income, gross_monthly: Number(correction) } };
      const verified = await reverify(nextProfile, institution, documents);
      setProfile(nextProfile); setResult(verified); setIssue(verified.issues[0] ?? null); setExplanation("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not re-verify the corrected information."); }
    finally { setLoading(null); }
  }

  async function updateEmploymentType(type: "salaried" | "self_employed" | "other") {
    if (!profile || !institution) return;
    setLoading("evaluation"); setError("");
    try {
      const nextProfile = { ...profile, employment: { ...profile.employment, type } };
      const evaluated = await evaluate(nextProfile, institution, documents);
      setProfile(nextProfile); setResult(evaluated);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not update your employment type."); }
    finally { setLoading(null); }
  }

  async function updateProfileField(patch: Partial<CanonicalProfile>) {
    if (!profile || !institution) return;
    setLoading("evaluation"); setError("");
    try {
      const nextProfile = {
        ...profile,
        ...patch,
        income: patch.income ? { ...profile.income, ...patch.income } : profile.income,
        employment: patch.employment ? { ...profile.employment, ...patch.employment } : profile.employment,
      };
      const evaluated = await evaluate(nextProfile, institution, documents);
      setProfile(nextProfile); setResult(evaluated); setIssue(evaluated.issues[0] ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not update your information."); }
    finally { setLoading(null); }
  }

  if (screen === "landing") return <LandingScreen onStart={() => setScreen("onboarding")} />;
  if (screen === "onboarding") return <OnboardingScreen message={message} setMessage={setMessage} profile={profile} phase={chatPhase} onStart={startPreFlight} onContinue={continueFromChat} onBack={() => { setChatPhase("empty"); setScreen("landing"); }} loading={loading} error={error} setProfile={setProfile} />;
  if (screen === "understanding") return <UnderstandingScreen message={message} profile={profile} loading={loading === "intent"} error={error} onRetry={() => { setError(""); setScreen("onboarding"); }} onComplete={() => setScreen("preparation")} />;
  if (!profile || !institution || !result) return null;
  return <><DashboardScreen profile={profile} result={result} issue={issue} explanation={explanation} correction={correction} setCorrection={setCorrection} onCorrect={confirmCorrection} onUpload={handleUpload} onEmploymentTypeChange={updateEmploymentType} onProfileFieldChange={updateProfileField} onInstitutionChange={changeInstitution} institution={institution} institutionCatalog={institutionCatalog} loading={loading} error={error} documentType={documentType} setDocumentType={setDocumentType} selectedExplanation={selectedExplanation} setSelectedExplanation={setSelectedExplanation} askOpen={askOpen} setAskOpen={setAskOpen} />{reconciliationNotice && <div className="reconciliation-success-notice" role="status"><CheckCircle2 size={18} /><div><strong>Information verified</strong><span>Application updated</span></div></div>}</>;
}


function Brand() { return <div className="brand"><span className="brand-mark"><Plane size={18} strokeWidth={2.4} /></span><span>Pre-Flight</span></div>; }
function LandingScreen({ onStart }: { onStart: () => void }) {
  return <main className="landing-page">
    <header className="landing-nav"><Brand /><nav className="landing-links"><a href="#how-it-works">How it works</a><a href="#why-preflight">Why Pre-Flight</a><a href="#for-you">For you</a></nav><button className="nav-cta" onClick={onStart}>Get started <ArrowRight size={16} /></button></header>
    <section className="hero-section"><div className="hero-copy"><div className="eyebrow"><span /> BEFORE YOU APPLY</div><h1>Before you apply,<br /><em>be ready.</em></h1><p>Understand what you're providing, see what's missing, and verify important information before you submit.</p><div className="hero-actions"><button className="hero-cta" onClick={onStart}>Start Pre-Flight <ArrowRight size={18} /></button><a className="secondary-cta" href="#how-it-works">See how it works <ArrowDown size={15} /></a></div><div className="hero-trust"><ShieldCheck size={16} /><span>A preparation layer, not a lending decision.</span></div></div><HeroVisual /></section>
    <section className="story-section problem-section"><div className="section-lead"><span className="section-number">01 / THE PROBLEM</span><h2>Applications shouldn't feel like <em>guesswork.</em></h2><p>Before you submit, there can be missing details, unclear requirements, or information that doesn't match your documents.</p></div><ProblemVisual /></section>
    <section className="journey-section" id="how-it-works"><div className="center-lead"><span className="section-number">02 / HOW IT WORKS</span><h2>From what you say to<br /><em>what you're ready to submit.</em></h2></div><div className="journey-line">{[["01", "Tell us", "Describe what you're applying for naturally.", Sparkles], ["02", "Understand", "Turn your message into a structured profile.", ScanLine], ["03", "Verify", "Optional documents help verify what you provided.", FileCheck2], ["04", "Fix & re-check", "Resolve conflicts and verify again.", CheckCircle2]].map(([number, title, copy, Icon]) => <div className="journey-step" key={number as string}><div className="step-icon"><Icon size={20} /></div><span>{number as string}</span><h3>{title as string}</h3><p>{copy as string}</p></div>)}</div></section>
    <section className="product-section"><div className="section-lead"><span className="section-number">03 / THE PRODUCT</span><h2>Know exactly<br /><em>where you stand.</em></h2><p>One practical view of the information you have provided, the evidence you choose to share, and the next step.</p><button className="outline-cta" onClick={onStart}>Explore your preparation <ArrowRight size={16} /></button></div><PreparationVisual /></section>
    <section className="verification-section" id="why-preflight"><div className="verification-copy"><span className="section-number">04 / VERIFICATION</span><h2>Catch conflicts before they become <em>problems.</em></h2><p>Pre-Flight compares your information with optional supporting evidence and makes the difference clear before submission.</p><div className="source-chip"><FileText size={15} /><span>Salary Slip</span><i /> <span>Page 1</span></div></div><VerificationVisual /></section>
    <section className="correction-section"><div className="center-lead"><span className="section-number">05 / RESOLUTION</span><h2>Find it. Fix it.<br /><em>Re-check it.</em></h2><p>Preparation is a conversation, not a dead end.</p></div><CorrectionVisual /></section>
    <section className="final-cta" id="for-you"><div className="final-orbit"><Plane size={25} /></div><span className="section-number">READY WHEN YOU ARE</span><h2>Be ready before<br /><em>you apply.</em></h2><p>Understand your application. Verify your information. Fix issues before you submit.</p><button className="hero-cta" onClick={onStart}>Start Pre-Flight <ArrowRight size={18} /></button></section>
    <footer className="landing-footer"><Brand /><span>Prepare. Verify. Apply.</span><small>Designed as a Paytm ecosystem concept · Pre-Flight is a preparation layer, not a lending decision.</small></footer>
  </main>;
}

function UnderstandingScreen({ message, profile, loading, error, onRetry, onComplete }: { message: string; profile: CanonicalProfile | null; loading: boolean; error: string; onRetry: () => void; onComplete: () => void }) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [prepared, setPrepared] = useState(false);
  const items = profile ? [
    { label: "Loan amount", value: formatMoney(profile.loan_amount), present: profile.loan_amount !== null },
    { label: "Loan tenure", value: profile.tenure_months === null ? "Not provided" : `${profile.tenure_months} months`, present: profile.tenure_months !== null },
    { label: "Monthly income", value: formatMoney(profile.income.gross_monthly), present: profile.income.gross_monthly !== null },
    { label: "Existing EMI", value: formatMoney(profile.existing_emi), present: profile.existing_emi !== null },
    { label: "Employment type", value: profile.employment.type === null ? "Not provided" : profile.employment.type === "self_employed" ? "Self-employed" : profile.employment.type === "salaried" ? "Salaried" : "Other", present: profile.employment.type !== null },
  ] : [];

  useEffect(() => {
    setRevealedCount(0);
    setPrepared(false);
    if (!profile) return;
    const revealTimes = [500, 1000, 1500, 2000, 2300];
    const revealTimers = items.map((_, index) => window.setTimeout(() => setRevealedCount(index + 1), revealTimes[index]));
    const preparedTimer = window.setTimeout(() => setPrepared(true), 2600);
    const completeTimer = window.setTimeout(onComplete, 3000);
    return () => {
      revealTimers.forEach(window.clearTimeout);
      window.clearTimeout(preparedTimer);
      window.clearTimeout(completeTimer);
    };
  }, [profile]);

  const activeStage = error ? 1 : !profile ? 1 : revealedCount < items.length ? 2 : 3;
  const flow = ["Your request", "Understanding", "Application information", "Pre-flight check"];
  return <main className="understanding-page"><header className="onboarding-nav understanding-nav"><Brand /><span>APPLICATION PREPARATION</span></header><section className="understanding-shell"><div className="understanding-intro"><span className="eyebrow"><span /> PRE-FLIGHT</span><h1>Understanding your application</h1><p>We are turning what you shared into information Pre-Flight can check.</p></div><div className="understanding-flow" aria-label="Application preparation progress">{flow.map((stage, index) => <div className={`flow-stage ${index < activeStage ? "complete" : index === activeStage ? "current" : "pending"}`} key={stage}><span className="flow-dot">{index < activeStage ? <Check size={13} /> : index + 1}</span><strong>{stage}</strong>{index < flow.length - 1 && <span className="flow-line" />}</div>)}</div><div className="understanding-content"><blockquote>“{message}”</blockquote>{error ? <div className="understanding-error"><TriangleAlert size={18} /><div><h2>We couldn't fully understand your application.</h2><p>Please try describing how much you want to borrow, for how long, your monthly income, and existing EMI, if any.</p><button type="button" onClick={onRetry}>Try again <ArrowRight size={15} /></button></div></div> : <div className="understanding-list">{items.map((item, index) => <article className={`understanding-item ${index < revealedCount ? "revealed" : ""}`} key={item.label}><div className={`understanding-status ${index < revealedCount ? item.present ? "understood" : "missing" : "waiting"}`}>{index < revealedCount ? item.present ? <Check size={16} /> : <Circle size={11} /> : <span />}</div><div><strong>{item.label}</strong><span>{index < revealedCount ? item.value : ""}</span></div>{index < revealedCount && <b>{item.present ? "Understood" : "Not provided"}</b>}</article>)}{prepared && <div className="understanding-complete"><CheckCircle2 size={18} /><span>Application information prepared</span></div>}{loading && <div className="understanding-loading"><span /> Securing your application details...</div>}</div>}</div></section></main>;
}

function OnboardingScreen({ message, setMessage, profile, phase, onStart, onContinue, onBack, loading, error, setProfile }: { message: string; setMessage: (value: string) => void; profile: CanonicalProfile | null; phase: "empty" | "understood"; onStart: () => void; onContinue: () => void; onBack: () => void; loading: string | null; error: string; setProfile: (profile: CanonicalProfile) => void }) {
  const prompts = ["I need a personal loan", "I want a credit card", "I'm not sure what I need"];
  return <main className="onboarding-page"><header className="onboarding-nav"><button className="back-button" onClick={onBack}>←</button><Brand /><span>APPLICATION PREPARATION</span></header><section className={`conversation ${phase === "understood" ? "conversation-active" : ""}`}>{phase === "empty" ? <div className="conversation-empty"><div className="welcome-mark"><Plane size={22} /></div><span className="eyebrow">LET'S GET STARTED</span><h1>Let's get your application<br /><em>ready.</em></h1><p>Tell me what you're looking to apply for. You can describe it naturally and I'll help organize the details.</p><div className="prompt-list">{prompts.map((prompt) => <button key={prompt} onClick={() => setMessage(prompt)}>{prompt}<ArrowRight size={15} /></button>)}</div></div> : <ConversationThread profile={profile!} setProfile={setProfile} />}{phase === "empty" && <div className="chat-composer"><label htmlFor="intent">Your application, in your own words</label><textarea id="intent" value={message} onChange={(event) => setMessage(event.target.value)} rows={3} placeholder="Tell me what you're looking for..." /><ComposerFooter loading={loading === "intent"} action={onStart} actionLabel="Send to Pre-Flight" disabled={!message.trim()} /></div>}{phase === "understood" && <div className="chat-composer follow-up-composer"><label>Continue the conversation</label><div className="follow-up-row"><span>Review what Pre-Flight understood, then continue when ready.</span><button onClick={onContinue} disabled={loading === "evaluation"}>{loading === "evaluation" ? <><LoaderCircle className="spin" size={16} /> Opening preparation...</> : <>Continue to preparation <ArrowRight size={16} /></>}</button></div></div>}{error && <ErrorNotice message={error} />}</section></main>;
}

function ComposerFooter({ loading, action, actionLabel, disabled }: { loading: boolean; action: () => void; actionLabel: string; disabled: boolean }) { return <div className="composer-footer"><span><span className="composer-plus">+</span> Attach later · No documents needed yet</span><button onClick={action} disabled={loading || disabled}>{loading ? <><LoaderCircle className="spin" size={16} /> Preparing...</> : <>{actionLabel} <ArrowRight size={16} /></>}</button></div>; }
function ConversationThread({ profile, setProfile }: { profile: CanonicalProfile; setProfile: (profile: CanonicalProfile) => void }) {
  const [editingEmployment, setEditingEmployment] = useState(false);
  const employmentKnown = profile.employment.type !== null && !editingEmployment;
  const selectEmploymentType = (type: "salaried" | "self_employed" | "other") => {
    setProfile({ ...profile, employment: { ...profile.employment, type } });
    setEditingEmployment(false);
  };
  return <div className="conversation-thread"><div className="user-bubble"><span>You</span><p>I need {formatMoney(profile.loan_amount)} for {profile.tenure_months} months. I earn {formatMoney(profile.income.gross_monthly)} and have an EMI of {formatMoney(profile.existing_emi)}.</p></div><div className="assistant-turn"><div className="assistant-avatar"><Plane size={15} /></div><div className="assistant-copy"><span>Pre-Flight</span><h2>Got it. I'll help you prepare this application.</h2><p>I found the loan amount, tenure, monthly income, and existing EMI. Here's what I have so far:</p><div className="profile-card"><ProfileLine label="Loan amount" value={formatMoney(profile.loan_amount)} /><ProfileLine label="Tenure" value={profile.tenure_months ? `${profile.tenure_months} months` : "Not provided yet"} /><ProfileLine label="Monthly income" value={formatMoney(profile.income.gross_monthly)} /><ProfileLine label="Existing EMI" value={formatMoney(profile.existing_emi)} /><ProfileLine label="Employment type" value={profile.employment.type ? profile.employment.type.replace("_", " ") : "Not provided yet"} muted={!profile.employment.type} /></div>{employmentKnown ? <div className="known-field"><span>Employment type already understood</span><strong>{profile.employment.type === "self_employed" ? "Self-employed" : profile.employment.type === "salaried" ? "Salaried" : "Other"} <Check size={14} /></strong><button onClick={() => setEditingEmployment(true)}>Change</button></div> : <><p className="assistant-question">One detail is still missing. Are you salaried, self-employed, or something else?</p><div className="response-chips"><button onClick={() => selectEmploymentType("salaried")}>Salaried</button><button onClick={() => selectEmploymentType("self_employed")}>Self-employed</button><button onClick={() => selectEmploymentType("other")}>Other</button></div></>}</div></div></div>;
}
function ProfileLine({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) { return <div className="profile-line"><span>{label}</span><strong className={muted ? "muted" : ""}>{value}</strong></div>; }

function HeroVisual() { return <div className="hero-visual"><div className="visual-glow" /><div className="hero-dashboard"><div className="mock-top"><span><span className="mini-brand" /> Pre-Flight</span><span className="mock-pill">APPLICATION PREPARATION</span></div><div className="mock-user-message">I need ₹3 lakh for 24 months. I earn ₹60,000 and have an EMI of ₹7,000.</div><div className="mock-title"><div><small>WHAT WE FOUND</small><strong>Personal loan</strong></div><div className="mock-ready">3 <span>/ 4<br /><small>READY</small></span></div></div><div className="mock-progress"><i /><i /><i /><i /></div><MockRow label="Loan amount" value="₹3,00,000" state="PROVIDED" tone="blue" /><MockRow label="Tenure" value="24 months" state="PROVIDED" tone="blue" /><MockRow label="Monthly income" value="₹60,000" state="VERIFIED" tone="green" /><MockRow label="Employment type" value="Missing" state="MISSING" tone="grey" /></div><div className="float-doc"><div className="doc-icon"><FileText size={18} /></div><div><strong>Salary slip</strong><span>Optional verification</span></div><CheckCircle2 size={18} /></div><div className="float-route"><span /><ArrowRight size={16} /></div></div>; }
function MockRow({ label, value, state, tone }: { label: string; value: string; state: string; tone: string }) { return <div className={`mock-row ${tone}`}><span className="mock-check">{tone === "grey" ? <Circle size={13} /> : <Check size={13} />}</span><div><strong>{label}</strong><span>{value}</span></div><b>{state}</b></div>; }
function ProblemVisual() { return <div className="problem-visual"><div className="messy-stack"><span>Missing information <Circle size={13} /></span><span>Conflicting values <TriangleAlert size={13} /></span><span>Unclear requirements <Circle size={13} /></span></div><div className="problem-arrow"><ArrowDown size={25} /></div><div className="clear-state"><div><CheckCircle2 size={22} /><span>PRE-FLIGHT</span></div><strong>Clear preparation</strong><small>Know what to do next</small></div></div>; }
function PreparationVisual() { return <div className="prep-visual"><div className="prep-bar"><span>Pre-Flight</span><span>Application Preparation <Circle size={7} fill="currentColor" /></span></div><div className="prep-body"><div className="prep-side"><span className="active" /><span /><span /></div><div className="prep-main"><small>PRE-FLIGHT / APPLICATION</small><h3>Application Preparation</h3><div className="prep-cards"><MockRow label="Loan amount" value="₹3,00,000" state="PROVIDED" tone="blue" /><MockRow label="Tenure" value="24 months" state="PROVIDED" tone="blue" /><MockRow label="Monthly income" value="₹60,000" state="VERIFIED" tone="green" /><MockRow label="Employment type" value="Missing" state="MISSING" tone="grey" /></div></div><div className="prep-next"><small>NEXT STEPS</small><strong>Provide your employment type</strong><p>One detail is still missing from your profile.</p><span><ArrowRight size={15} /> Review next step</span></div></div></div>; }
function VerificationVisual() { return <div className="verification-visual"><div className="verify-card provided-card"><small>YOU PROVIDED</small><strong>₹60,000</strong><span>Monthly income</span></div><div className="verify-connector"><span>compare</span><ArrowRight size={20} /></div><div className="verify-card document-card"><div><FileText size={17} /><small>SALARY SLIP · PAGE 1</small></div><strong>₹50,000</strong><span>Gross salary</span></div><div className="difference-badge"><TriangleAlert size={15} /> Difference ₹10,000</div></div>; }
function CorrectionVisual() { return <div className="correction-visual"><div className="correction-node muted"><span>DECLARED</span><strong>₹60,000</strong></div><ArrowDown className="correction-arrow" size={21} /><div className="correction-node amber"><span>NEEDS CLARIFICATION</span><strong>Review the difference</strong></div><ArrowDown className="correction-arrow" size={21} /><div className="correction-node verified"><CheckCircle2 size={22} /><div><span>RE-VERIFIED</span><strong>₹50,000 = ₹50,000</strong></div></div></div>; }
function Feature({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) { return <article className="feature"><div className="feature-icon">{icon}</div><h3>{title}</h3><p>{copy}</p><ArrowRight className="feature-arrow" size={16} /></article>; }

/*

function PreparationScreen({ profile, result, issue, explanation, correction, setCorrection, onCorrect, onUpload, onEmploymentTypeChange, loading, error, documentType, setDocumentType, selectedExplanation, setSelectedExplanation, askOpen, setAskOpen }: { profile: CanonicalProfile; result: VerificationResult; issue: Issue | null; explanation: string; correction: string; setCorrection: (value: string) => void; onCorrect: () => void; onUpload: (file: File) => void; onEmploymentTypeChange: (type: "salaried" | "self_employed" | "other") => void; loading: string | null; error: string; documentType: SupportingDocumentType; setDocumentType: (value: SupportingDocumentType) => void; selectedExplanation: "salary_revision" | "gross_net_difference" | "recent_job_change" | null; setSelectedExplanation: (value: "salary_revision" | "gross_net_difference" | "recent_job_change" | null) => void; askOpen: boolean; setAskOpen: (open: boolean) => void }) {
  const readyCount = result.checks.filter((check) => check.status === "PROVIDED" || check.status === "VERIFIED").length;
  const missingCheck = result.checks.find((check) => check.status === "MISSING");
  const attentionTitle = issue ? "Needs clarification" : missingCheck ? "Next step" : "Ready to review";
  const attentionCopy = issue
    ? issue.canonical_field.startsWith("income.") ? "Your declared income differs from the salary slip." : issue.canonical_field.startsWith("employment.") ? "Your employment information needs clarification." : "More information is needed to complete this check."
      return <main className="app-shell preparation-dashboard"><aside className="sidebar"><Brand /><div className="side-label">APPLICATION</div><nav><button className="nav-item active"><FolderOpen size={17} /> Application Preparation</button></nav>
    : missingCheck
      ? result.next_actions.find((action) => action.toLowerCase().includes(missingCheck.label.toLowerCase())) ?? `Provide your ${missingCheck.label.toLowerCase()}.`
      : "Your provided information is complete.";
  return <main className="app-shell preparation-dashboard"><aside className="sidebar"><Brand /><div className="side-label">YOUR JOURNEY</div><nav><button className="nav-item active"><FolderOpen size={17} /> Application Preparation</button><button className="nav-item"><FileText size={17} /> Documents</button><button className="nav-item"><ArrowRight size={17} /> Next Steps</button></nav><div className="sidebar-note"><div className="mini-plane"><Plane size={16} /></div><strong>One step at a time.</strong><span>Get your application ready with confidence.</span></div><div className="sidebar-bottom">Pre-Flight MVP <span>v0.1</span></div></aside><section className="workspace dashboard-workspace"><header className="workspace-header"><div><div className="breadcrumb">PRE-FLIGHT <span>/</span> APPLICATION</div><h1>Application Preparation</h1><p>See what's ready, what's missing, and what needs your attention.</p></div><div className="readiness-meter"><strong>{readyCount}<small> / {result.checks.length}</small></strong><span>INFORMATION READY</span></div></header>{error && <ErrorNotice message={error} />}<div className="dashboard-grid"><section className="dashboard-card application-card"><div className="card-heading"><div><span className="card-kicker">APPLICATION</span><h2>Personal loan</h2></div><span className="application-status">{result.overall_state === "NEEDS_CLARIFICATION" ? "Review needed" : result.overall_state === "MISSING" ? "In progress" : "On track"}</span></div><div className="application-facts"><div><span>Loan amount</span><strong>{formatMoney(profile.loan_amount)}</strong></div><div><span>Tenure</span><strong>{profile.tenure_months ? `${profile.tenure_months} months` : "Missing"}</strong></div></div></section><section className={`dashboard-card attention-card ${issue ? "attention-issue" : missingCheck ? "attention-missing" : "attention-ready"}`}><div className="attention-label"><span className="attention-marker" />{attentionTitle}</div><h2>{attentionCopy}</h2>{issue ? <button className="card-action" onClick={() => document.querySelector(".issue-card")?.scrollIntoView({ behavior: "smooth" })}>Inspect issue <ArrowRight size={15} /></button> : missingCheck ? <span className="attention-meta">{missingCheck.label} is not in your profile yet.</span> : <span className="attention-meta">All currently provided information is accounted for.</span>}</section><section className="dashboard-card information-card"><div className="card-heading"><div><span className="card-kicker">01 / CHECKS</span><h2>Information check</h2></div><div className="card-inline-actions"><button className="card-inline-button" type="button" onClick={openInformationEditor}><PencilLine size={12} /> Check / change</button><span className="card-count">{readyCount} of {result.checks.length}</span></div></div><div className="dashboard-checks">{result.checks.map((check) => <CheckRow key={check.id} check={check} value={formatCheckValue(check, profile)} />)}</div>{infoEditorOpen && <div className="check-dialog-backdrop" onClick={() => { if (!infoHasChanges) setInfoEditorOpen(false); }}><div className="check-dialog" onClick={(event) => event.stopPropagation()}><div className="check-dialog-header"><div><span className="card-kicker">01 / CHECKS</span><h3>Update information</h3></div><button className="close-dialog" type="button" onClick={() => { if (!infoHasChanges) { setInfoEditorOpen(false); return; } discardInformationChanges(); }} aria-label="Close editor"><X size={16} /></button></div><div className="check-dialog-list"><div className="dialog-field"><span>Loan amount</span><input type="number" value={draftProfile.loan_amount ?? ""} onChange={(event) => setDraftProfile((current) => ({ ...current, loan_amount: event.target.value === "" ? null : Number(event.target.value) }))} /></div><div className="dialog-field"><span>Tenure</span><input type="number" value={draftProfile.tenure_months ?? ""} onChange={(event) => setDraftProfile((current) => ({ ...current, tenure_months: event.target.value === "" ? null : Number(event.target.value) }))} /></div><div className="dialog-field"><span>Monthly income</span><input type="number" value={draftProfile.income.gross_monthly ?? ""} onChange={(event) => setDraftProfile((current) => ({ ...current, income: { ...current.income, gross_monthly: event.target.value === "" ? null : Number(event.target.value) } }))} /></div><div className="dialog-field"><span>Employment type</span><div className="segmented-options">{(["salaried", "self_employed", "other"] as const).map((type) => <button key={type} type="button" className={`segment-option ${draftProfile.employment.type === type ? "active" : ""}`} onClick={() => setDraftProfile((current) => ({ ...current, employment: { ...current.employment, type } }))}>{type === "salaried" ? "Salaried" : type === "self_employed" ? "Self-employed" : "Other"}</button>)}</div></div></div><div className="check-dialog-actions"><button className="secondary-action" type="button" onClick={discardInformationChanges} hidden={!infoHasChanges}>Discard changes</button><button className="primary-action" type="button" onClick={saveInformationChanges} disabled={!infoHasChanges}>Save changes</button></div></div></div>}</section><div className="dashboard-side"><DocumentsCard requirements={result.document_requirements} onUpload={onUpload} loading={loading === "document"} documentType={documentType} setDocumentType={setDocumentType} /><section className="dashboard-note"><ShieldCheck size={17} /><p>Documents are optional. Upload them if you'd like to verify the information you've provided.</p></section></div>{issue && <div className="dashboard-issue"><IssueCard issue={issue} explanation={explanation} correction={correction} setCorrection={setCorrection} onCorrect={onCorrect} onUpload={onUpload} loading={loading === "document" || loading === "reverify"} documentType={documentType} setDocumentType={setDocumentType} selectedExplanation={selectedExplanation} setSelectedExplanation={setSelectedExplanation} /></div>}</div><footer className="workspace-footer"><span><span className="status-dot" /> Based on the information you provide.</span><button onClick={() => window.location.reload()}><RefreshCw size={14} /> Start a new pre-flight</button></footer></section></main>;
}

*/
function DashboardScreen(props: Parameters<typeof DashboardScreenContent>[0]) {
  return <><DashboardScreenContent {...props} /><DashboardInformationEditor profile={props.profile} onSave={props.onProfileFieldChange} loading={props.loading} /><UpdateStatusBanner loading={props.loading} result={props.result} />{props.result.reconciliation?.status !== "VERIFIED" && <ReconciliationSummary result={props.result} />}</>;
}

function DashboardInformationEditor({ profile, onSave, loading }: { profile: CanonicalProfile; onSave: (patch: Partial<CanonicalProfile>) => void; loading: string | null }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile]);
  const changed = draft.loan_amount !== profile.loan_amount || draft.tenure_months !== profile.tenure_months || draft.income.gross_monthly !== profile.income.gross_monthly || draft.employment.type !== profile.employment.type;
  const save = () => {
    onSave({ loan_amount: draft.loan_amount, tenure_months: draft.tenure_months, income: { ...profile.income, gross_monthly: draft.income.gross_monthly }, employment: { ...profile.employment, type: draft.employment.type } });
    setOpen(false);
  };
  return <div className="dashboard-edit-control"><button type="button" className="dashboard-edit-button" onClick={() => { setDraft(profile); setOpen(true); }}><PencilLine size={14} /> Change application information</button>{open && <div className="check-dialog-backdrop" onClick={() => setOpen(false)}><div className="check-dialog" onClick={(event) => event.stopPropagation()}><div className="check-dialog-header"><div><span className="card-kicker">APPLICATION INFORMATION</span><h3>Change your information</h3></div><button className="close-dialog" type="button" onClick={() => setOpen(false)} aria-label="Close editor"><X size={16} /></button></div><div className="check-dialog-list"><div className="dialog-field"><span>Loan amount</span><input type="number" value={draft.loan_amount ?? ""} onChange={(event) => setDraft((current) => ({ ...current, loan_amount: event.target.value === "" ? null : Number(event.target.value) }))} /></div><div className="dialog-field"><span>Loan tenure</span><input type="number" value={draft.tenure_months ?? ""} onChange={(event) => setDraft((current) => ({ ...current, tenure_months: event.target.value === "" ? null : Number(event.target.value) }))} /></div><div className="dialog-field"><span>Monthly income</span><input type="number" value={draft.income.gross_monthly ?? ""} onChange={(event) => setDraft((current) => ({ ...current, income: { ...current.income, gross_monthly: event.target.value === "" ? null : Number(event.target.value) } }))} /></div><div className="dialog-field"><span>Employment type</span><div className="segmented-options">{(["salaried", "self_employed", "other"] as const).map((type) => <button key={type} type="button" className={`segment-option ${draft.employment.type === type ? "active" : ""}`} onClick={() => setDraft((current) => ({ ...current, employment: { ...current.employment, type } }))}>{type === "salaried" ? "Salaried" : type === "self_employed" ? "Self-employed" : "Other"}</button>)}</div></div></div><div className="check-dialog-actions"><button className="secondary-action" type="button" onClick={() => { setDraft(profile); setOpen(false); }}>Cancel</button><button className="primary-action" type="button" onClick={save} disabled={!changed || loading !== null}>{loading ? "Updating..." : "Save changes"}</button></div></div></div>}</div>;
}

function UpdateStatusBanner({ loading, result }: { loading: string | null; result: VerificationResult }) {
  const incomeCheck = result.checks.find((check) => check.id === "monthly_income");
  const updating = loading === "evaluation" || loading === "reverify";
  const verified = !updating && incomeCheck?.status === "VERIFIED";
  if (!updating && !verified) return null;
  return <div className={`update-status-banner ${verified ? "verified" : "updating"}`} aria-live="polite">{verified ? <CheckCircle2 size={18} /> : <LoaderCircle className="spin" size={18} />}<div><strong>{verified ? "Information updated and verified" : "Updating your application information..."}</strong><span>{verified ? "The updated value matches the supporting evidence." : "Checking the updated information against your documents."}</span></div></div>;
}

function DashboardScreenContent({ profile, result, issue, explanation, correction, setCorrection, onCorrect, onUpload, onEmploymentTypeChange, onProfileFieldChange, onInstitutionChange, institution, institutionCatalog, loading, error, documentType, setDocumentType, selectedExplanation, setSelectedExplanation, askOpen, setAskOpen }: { profile: CanonicalProfile; result: VerificationResult; issue: Issue | null; explanation: string; correction: string; setCorrection: (value: string) => void; onCorrect: () => void; onUpload: (file: File) => void; onEmploymentTypeChange: (type: "salaried" | "self_employed" | "other") => void; onProfileFieldChange: (patch: Partial<CanonicalProfile>) => void; onInstitutionChange: (institution: InstitutionConfig) => void; institution: InstitutionConfig | null; institutionCatalog: InstitutionConfig[]; loading: string | null; error: string; documentType: SupportingDocumentType; setDocumentType: (value: SupportingDocumentType) => void; selectedExplanation: "salary_revision" | "gross_net_difference" | "recent_job_change" | null; setSelectedExplanation: (value: "salary_revision" | "gross_net_difference" | "recent_job_change" | null) => void; askOpen: boolean; setAskOpen: (open: boolean) => void }) {
  const [editingEmployment, setEditingEmployment] = useState(false);
  const [askMessage, setAskMessage] = useState("");
  const [askReply, setAskReply] = useState("");
  const [infoEditorOpen, setInfoEditorOpen] = useState(false);
  const [draftProfile, setDraftProfile] = useState<CanonicalProfile>(profile);
  const readyCount = result.checks.filter((check) => check.status === "PROVIDED" || check.status === "VERIFIED").length;
  const labels: Record<string, string> = { loan_amount: "Loan amount", tenure_months: "Loan tenure", monthly_income: "Monthly income", employment_type: "Employment type" };
  const employmentLabel = profile.employment.type === "self_employed" ? "Self-employed" : profile.employment.type === "salaried" ? "Salaried" : profile.employment.type === "other" ? "Other" : "Not provided yet";
  const infoHasChanges = JSON.stringify({
    loan_amount: draftProfile.loan_amount,
    tenure_months: draftProfile.tenure_months,
    income: draftProfile.income,
    employment: draftProfile.employment,
    existing_emi: draftProfile.existing_emi,
    purpose: draftProfile.purpose,
    product: draftProfile.product,
  }) !== JSON.stringify({
    loan_amount: profile.loan_amount,
    tenure_months: profile.tenure_months,
    income: profile.income,
    employment: profile.employment,
    existing_emi: profile.existing_emi,
    purpose: profile.purpose,
    product: profile.product,
  });
  useEffect(() => { setDraftProfile(profile); }, [profile]);
  const openInformationEditor = () => {
    setDraftProfile(profile);
    setInfoEditorOpen(true);
  };
  const discardInformationChanges = () => {
    setDraftProfile(profile);
    setInfoEditorOpen(false);
  };
  const saveInformationChanges = () => {
    onProfileFieldChange({
      loan_amount: draftProfile.loan_amount,
      tenure_months: draftProfile.tenure_months,
      income: { ...profile.income, gross_monthly: draftProfile.income.gross_monthly },
      employment: { ...profile.employment, type: draftProfile.employment.type },
    });
    setInfoEditorOpen(false);
  };
  const answerQuestion = (question: string) => {
    const lower = question.toLowerCase();
    if (lower.includes("employment") && lower.includes("missing")) setAskReply(profile.employment.type ? `Employment type is ${employmentLabel} in your application profile.` : "Employment type is missing because it has not been provided in your application profile yet.");
    else if (lower.includes("provided")) setAskReply("Provided means you entered the information, but it may not have supporting document evidence yet.");
    else if (lower.includes("document")) setAskReply("You can optionally upload a salary slip or bank statement from the Supporting documents card.");
    else if (lower.includes("income")) setAskReply("Income verification compares your provided income with the value found in uploaded evidence.");
    else if (lower.includes("salaried")) { void onEmploymentTypeChange("salaried"); setEditingEmployment(false); setAskReply("I updated your application profile to Salaried and rechecked the preparation state."); }
    else setAskReply("I can explain your application information, documents, and next steps from this dashboard.");
  };
  return <main className="app-shell preparation-dashboard"><aside className="sidebar"><Brand /><div className="side-label">YOUR JOURNEY</div><nav><button className="nav-item active"><FolderOpen size={17} /> Application Preparation</button><button className="nav-item"><FileText size={17} /> Documents</button><button className="nav-item"><ArrowRight size={17} /> Next Steps</button></nav><div className="sidebar-note"><div className="mini-plane"><Plane size={16} /></div><strong>One step at a time.</strong><span>Get your application ready with confidence.</span></div><div className="sidebar-bottom">Pre-Flight MVP <span>v0.1</span></div></aside><section className="workspace dashboard-workspace"><header className="workspace-header"><div><div className="breadcrumb">PRE-FLIGHT <span>/</span> APPLICATION</div><h1>Application Preparation</h1><p>See what's ready, what's missing, and what needs your attention.</p></div><div className="dashboard-header-actions"><button className="ask-button" onClick={() => setAskOpen(true)}><MessageCircle size={16} /> Ask Pre-Flight</button><div className="readiness-meter"><strong>{readyCount}<small> / {result.checks.length}</small></strong><span>INFORMATION READY</span></div></div></header>{error && <ErrorNotice message={error} />}<div className="dashboard-grid"><section className="dashboard-card application-card"><div className="card-heading"><div><span className="card-kicker">APPLICATION</span><h2>Personal loan</h2></div><span className="application-status">{result.overall_state === "NEEDS_CLARIFICATION" ? "Review needed" : result.overall_state === "MISSING" ? "In progress" : "On track"}</span></div><div className="application-facts"><div><span>Loan amount</span><strong>{formatMoney(profile.loan_amount)}</strong></div><div><span>Tenure</span><strong>{profile.tenure_months ? `${profile.tenure_months} months` : "Missing"}</strong></div></div></section><section className={`dashboard-card attention-card ${issue ? "attention-issue" : result.checks.some((check) => check.status === "MISSING") ? "attention-missing" : "attention-ready"}`}><div className="attention-label"><span className="attention-marker" />{issue ? "Needs clarification" : result.checks.some((check) => check.status === "MISSING") ? "Next step" : "Ready to review"}</div><h2>{issue ? "Review the information that needs clarification." : result.checks.some((check) => check.status === "MISSING") ? result.next_actions[0] ?? "Complete the missing information." : "Your provided information is complete."}</h2></section><section className="dashboard-card information-card"><div className="card-heading"><div><span className="card-kicker">01 / CHECKS</span><h2>Information check</h2></div><span className="card-count">{readyCount} of {result.checks.length}</span></div><div className="dashboard-checks">{result.checks.map((check) => { const checkLabel = labels[check.id] ?? check.label; return <DashboardCheckRow key={check.id} check={check} label={checkLabel} value={check.id === "employment_type" ? employmentLabel : formatCheckValue(check, profile)} editing={check.id === "employment_type" && editingEmployment} onAdd={() => { if (check.id === "employment_type") { setEditingEmployment(true); return; } setAskOpen(false); setAskReply(""); }} onSelect={(type) => { void onEmploymentTypeChange(type); setEditingEmployment(false); }} loading={loading === "evaluation"} onCheck={() => { setAskOpen(false); setAskReply(""); }} />; })}</div></section>{institutionCatalog.length > 0 && <section className="dashboard-card institution-card"><div className="card-heading"><div><span className="card-kicker">02 / LENDER CONTEXT</span><h2>Supported lender contexts</h2></div></div><div className="institution-grid">{institutionCatalog.map((item) => <button key={item.institution} type="button" className={`institution-chip ${institution?.institution === item.institution ? "selected" : ""}`} onClick={() => onInstitutionChange(item)}><span className="institution-tag">{item.institution.replace("_demo", "").toUpperCase()}</span><strong>{item.label}</strong><small>{item.requiredDocuments.length} document checks</small></button>)}</div></section>}<div className="dashboard-side"><DocumentsCard requirements={result.document_requirements} onUpload={onUpload} loading={loading === "document"} documentType={documentType} setDocumentType={setDocumentType} /></div>{issue && <div className="dashboard-issue"><IssueCard issue={issue} explanation={explanation} correction={correction} setCorrection={setCorrection} onCorrect={onCorrect} onUpload={onUpload} loading={loading === "document" || loading === "reverify"} documentType={documentType} setDocumentType={setDocumentType} selectedExplanation={selectedExplanation} setSelectedExplanation={setSelectedExplanation} /></div>}</div><footer className="workspace-footer"><span><span className="status-dot" /> Based on the information you provide.</span><button onClick={() => window.location.reload()}><RefreshCw size={14} /> Start a new pre-flight</button></footer></section>{askOpen && <aside className="ask-drawer"><div className="ask-drawer-header"><div><span className="card-kicker">CONTEXTUAL HELP</span><h2>Ask Pre-Flight</h2></div><button onClick={() => setAskOpen(false)} aria-label="Close Ask Pre-Flight"><X size={18} /></button></div><p>Ask about your application, information, documents, or next steps.</p><div className="ask-suggestions">{["Why is my employment type missing?", "What does Provided mean?", "Which documents can I upload?", "Why should I verify my income?"].map((question) => <button key={question} onClick={() => { setAskMessage(question); answerQuestion(question); }}>{question}<ArrowRight size={14} /></button>)}</div>{askReply && <div className="ask-reply"><span>Pre-Flight</span><p>{askReply}</p></div>}<div className="ask-composer"><input aria-label="Ask Pre-Flight" value={askMessage} onChange={(event) => setAskMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && askMessage.trim()) answerQuestion(askMessage); }} placeholder="Ask about your application..." /><button onClick={() => askMessage.trim() && answerQuestion(askMessage)} aria-label="Send question"><Send size={16} /></button></div></aside>}</main>;
}

function DashboardCheckRow({ check, label, value }: { check: { id: string; label: string; status: Status; detail: string }; label: string; value: string; editing?: boolean; onAdd?: () => void; onSelect?: (type: "salaried" | "self_employed" | "other") => void; loading?: boolean; onCheck?: () => void }) {
  const missing = check.status === "MISSING";
  return <article className={`check-row ${check.status.toLowerCase().replace("_", "-")}`}><div className="check-icon">{check.status === "VERIFIED" || check.status === "PROVIDED" ? <Check size={16} /> : check.status === "NEEDS_CLARIFICATION" ? <TriangleAlert size={16} /> : <Circle size={12} />}</div><div className="check-content"><strong>{label}</strong><span>{missing ? "Not provided yet" : value}</span></div><div className="check-status"><b>{statusLabel(check.status)}</b><small>{check.status === "VERIFIED" ? "Evidence matches" : check.status === "PROVIDED" ? "Provided by you" : check.status === "MISSING" ? "Action needed" : "Review needed"}</small></div></article>;
}

function ReconciliationSummary({ result }: { result: VerificationResult }) {
  const reconciliation = result.reconciliation;
  if (!reconciliation) return null;
  const resolved = reconciliation.status === "VERIFIED";
  const fieldLabel = (field: string) => ({ previous_salary: "Previous salary", revised_salary: "Revised salary", effective_date: "Effective date", gross_monthly_income: "Gross salary", income: "Monthly income", "income.gross_monthly": "Monthly income" }[field] ?? field.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()));
  const displayValue = (value: number | string) => typeof value === "number" ? `₹${value.toLocaleString("en-IN")}` : value;
  return <section className={`reconciliation-summary ${resolved ? "resolved" : "unresolved"}`}><div className="reconciliation-summary-header"><div className="reconciliation-summary-icon">{resolved ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}</div><div><span className="card-kicker">{resolved ? "EXPLANATION SUPPORTED" : "MORE EVIDENCE NEEDED"}</span><h2>{resolved ? "Explained" : "Needs clarification"}</h2></div></div><p className="reconciliation-summary-copy">{humanizeTechnicalTerms(reconciliation.explanation)}</p><div className="evidence-chain"><div className="evidence-chain-title">Evidence chain</div><div className="evidence-chain-step"><span>Your declaration</span><strong>{displayValue(reconciliation.user_declaration.value)}</strong><small>Original application information</small></div>{reconciliation.supporting_evidence.filter((evidence) => evidence.value !== 0).map((evidence, index) => <div className="evidence-chain-step" key={`${evidence.document_id}-${evidence.field}-${index}`}><span>{evidence.source_label}</span><strong>{fieldLabel(evidence.field)}: {displayValue(evidence.value)}</strong><small>{evidence.page ? `Page ${evidence.page}` : "Supporting document"}</small></div>)}{reconciliation.primary_evidence && <div className="evidence-chain-step"><span>{reconciliation.primary_evidence.source_label}</span><strong>{fieldLabel(reconciliation.primary_evidence.field)}: {displayValue(reconciliation.primary_evidence.value)}</strong><small>{reconciliation.primary_evidence.page ? `Page ${reconciliation.primary_evidence.page}` : "Primary document"}</small></div>}</div>{!resolved && <div className="reconciliation-next-step">Next step: provide a salary revision letter or HR salary certificate showing the change.</div>}</section>;
}

function LegacyPreparationScreen({ profile, result, issue, explanation, correction, setCorrection, onCorrect, onUpload, loading, error, documentType, setDocumentType, selectedExplanation, setSelectedExplanation }: { profile: CanonicalProfile; result: VerificationResult; issue: Issue | null; explanation: string; correction: string; setCorrection: (value: string) => void; onCorrect: () => void; onUpload: (file: File) => void; loading: string | null; error: string; documentType: SupportingDocumentType; setDocumentType: (value: SupportingDocumentType) => void; selectedExplanation: "salary_revision" | "gross_net_difference" | "recent_job_change" | null; setSelectedExplanation: (value: "salary_revision" | "gross_net_difference" | "recent_job_change" | null) => void }) {
  const readyCount = result.checks.filter((check) => check.status === "PROVIDED" || check.status === "VERIFIED").length;
  const isVerified = !issue && result.checks.some((check) => check.status === "VERIFIED");
  return <main className="app-shell"><aside className="sidebar"><Brand /><div className="side-label">YOUR JOURNEY</div><nav><button className="nav-item active"><FolderOpen size={17} /> Application Preparation</button><button className="nav-item"><FileText size={17} /> My Documents</button><button className="nav-item"><ArrowRight size={17} /> Next Steps</button></nav><div className="sidebar-note"><div className="mini-plane"><Plane size={16} /></div><strong>One step at a time.</strong><span>Get your application ready with confidence.</span></div><div className="sidebar-bottom">Pre-Flight MVP <span>v0.1</span></div></aside><section className="workspace"><header className="workspace-header"><div><div className="breadcrumb">PRE-FLIGHT <span>/</span> APPLICATION</div><h1>Application Preparation</h1><p>See what's ready, what's missing, and what needs your attention.</p></div><div className="progress-ring"><span>{readyCount}<small>/ {result.checks.length}</small></span><div>READY</div></div></header>{error && <ErrorNotice message={error} />}<div className="workspace-grid"><div className="main-column"><section className="section-block"><div className="section-heading"><div><span className="section-index">01</span><h2>Information check</h2></div><span className="progress-text">{readyCount} of {result.checks.length} information items ready</span></div><div className="check-list">{result.checks.map((check) => <CheckRow key={check.id} check={check} value={formatCheckValue(check, profile)} />)}</div></section>{issue ? <IssueCard issue={issue} explanation={explanation} correction={correction} setCorrection={setCorrection} onCorrect={onCorrect} onUpload={onUpload} loading={loading === "document" || loading === "reverify"} documentType={documentType} setDocumentType={setDocumentType} selectedExplanation={selectedExplanation} setSelectedExplanation={setSelectedExplanation} /> : isVerified ? <VerifiedCard profile={profile} /> : null}</div><div className="rail-column"><DocumentsCard requirements={result.document_requirements} onUpload={onUpload} loading={loading === "document"} documentType={documentType} setDocumentType={setDocumentType} /><section className="info-card"><div className="info-icon"><TriangleAlert size={17} /></div><div><strong>What Pre-Flight does</strong><p>It spots preparation gaps before you share an application. It does not predict approval or make lending decisions.</p></div></section></div></div><footer className="workspace-footer"><span><span className="status-dot" /> All checks are based on the information you provide.</span><button onClick={() => window.location.reload()}><RefreshCw size={14} /> Start a new pre-flight</button></footer></section></main>;
}

function CheckRow({ check, value }: { check: { id: string; label: string; status: Status; detail: string }; value: string }) { const tone = check.status.toLowerCase().replace("_", "-"); return <article className={`check-row ${tone}`}><div className="check-icon">{check.status === "VERIFIED" || check.status === "PROVIDED" ? <Check size={16} /> : check.status === "NEEDS_CLARIFICATION" ? <TriangleAlert size={16} /> : <Circle size={12} />}</div><div className="check-content"><strong>{check.label}</strong><span>{value}</span></div><div className="check-status"><b>{statusLabel(check.status)}</b><small>{check.status === "VERIFIED" ? "Evidence matches" : check.status === "PROVIDED" ? "Provided by you" : check.status === "MISSING" ? "Action needed" : "Review needed"}</small></div></article>; }
function DocumentsCard({ requirements, onUpload, loading, documentType, setDocumentType }: { requirements: VerificationResult["document_requirements"]; onUpload: (file: File) => void; loading: boolean; documentType: SupportingDocumentType; setDocumentType: (value: SupportingDocumentType) => void }) { return <section className="documents-card"><div className="section-heading compact"><div><span className="section-index">02</span><h2>Supporting documents</h2></div><FileText size={19} /></div><p className="documents-intro">Documents are optional. Upload them if you'd like to verify the information you've provided.</p><div className="document-list">{requirements.map((requirement) => <div className="document-row" key={requirement.document_type}><div className="document-icon"><FileText size={18} /></div><div className="document-copy"><strong>{requirement.label.replace(" evidence", "").replace(/^./, (letter) => letter.toUpperCase())}</strong><span>{requirement.provided ? "Uploaded for verification" : "Optional verification"}</span></div>{requirement.provided ? <span className="uploaded"><Check size={14} /> Added</span> : <label className="upload-button"><UploadCloud size={15} /> Upload<input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={loading} onChange={(event) => { const file = event.target.files?.[0]; if (file) { setDocumentType(requirement.document_type); onUpload(file); } }} /></label>}</div>)}</div><select className="document-select" value={documentType} onChange={(event) => setDocumentType(event.target.value as SupportingDocumentType)} aria-label="Document type"><option value="salary_slip">Salary slip</option><option value="bank_statement">Bank statement</option><option value="salary_revision_letter">Salary revision letter</option><option value="hr_salary_certificate">HR salary certificate</option><option value="offer_letter">Offer letter</option><option value="appointment_letter">Appointment letter</option><option value="employment_salary_certificate">Employment certificate</option></select>{loading && <div className="uploading"><LoaderCircle className="spin" size={16} /> Extracting structured evidence...</div>}</section>; }
function IssueCard({ issue, explanation, correction, setCorrection, onCorrect, onUpload = () => {}, loading, documentType = "salary_slip", setDocumentType = () => {}, selectedExplanation = null, setSelectedExplanation = () => {} }: { issue: Issue; explanation: string; correction: string; setCorrection: (value: string) => void; onCorrect: () => void; onUpload?: (file: File) => void; loading: boolean; documentType?: SupportingDocumentType; setDocumentType?: (value: SupportingDocumentType) => void; selectedExplanation?: "salary_revision" | "gross_net_difference" | "recent_job_change" | null; setSelectedExplanation?: (value: "salary_revision" | "gross_net_difference" | "recent_job_change" | null) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [uploadPhase, setUploadPhase] = useState<"idle" | "uploading" | "reading" | "extracted" | "error">("idle");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [previousSalaryConfirmed, setPreviousSalaryConfirmed] = useState(false);
  const mismatchOptions = issue.canonical_field.includes("employment")
    ? [{ id: "recent_job_change" as const, label: "I recently changed jobs" }]
    : [{ id: "salary_revision" as const, label: "My salary changed recently" }, { id: "gross_net_difference" as const, label: "I meant my take-home salary" }];
  const evidenceOptions = selectedExplanation === "salary_revision"
    ? ["salary_slip", "salary_revision_letter", "hr_salary_certificate"]
    : selectedExplanation === "recent_job_change"
      ? ["offer_letter", "appointment_letter", "employment_salary_certificate"]
      : ["salary_slip", "bank_statement"];

  const handleExplanationChange = (optionId: "salary_revision" | "gross_net_difference" | "recent_job_change") => {
    const nextDocumentType = optionId === "salary_revision"
      ? "salary_revision_letter"
      : optionId === "recent_job_change"
        ? "offer_letter"
        : "salary_slip";
    setSelectedExplanation(optionId);
    setPreviousSalaryConfirmed(optionId === "salary_revision");
    setDocumentType(nextDocumentType as SupportingDocumentType);
  };

  const handleEvidenceSelection = async (file: File) => {
    setSelectedFileName(file.name);
    setUploadPhase("uploading");
    await Promise.resolve();
    setUploadPhase("reading");
    try {
      const uploadWithContext = onUpload as unknown as (selectedFile: File, context?: ReconciliationContext) => Promise<boolean>;
      const context = selectedExplanation === "salary_revision" ? { explanation_type: "SALARY_REVISION" as const, previous_salary_confirmed: true } : undefined;
      const success = await Promise.resolve(uploadWithContext(file, context));
      setUploadPhase(success === true ? "extracted" : "error");
    } catch {
      setUploadPhase("error");
    }
  };

  return <section className="issue-card"><div className="issue-header"><div className="issue-badge"><TriangleAlert size={17} /></div><div><span className="issue-kicker">NEEDS CLARIFICATION</span><h2>Something needs clarification</h2></div></div><div className="comparison"><div><span>You provided</span><strong>{formatMoney(issue.declared_value)}</strong></div><div className="comparison-line"><span>difference</span><b>₹{issue.difference.toLocaleString("en-IN")}</b></div><div><span>Salary slip</span><strong>{formatMoney(issue.documented_value)}</strong></div></div><div className="why"><strong>Why are you seeing this?</strong><p>{explanation || "The value in your application does not match the supporting evidence yet."}</p></div><div className="provenance"><span>Source</span><strong>{issue.evidence.source_label}</strong><span>Page {issue.evidence.page}</span></div>
    <div className="mismatch-choice"><h3>What explains this difference?</h3><div className="choice-grid">{mismatchOptions.map((option) => <label key={option.id} className={`choice-option ${selectedExplanation === option.id ? "selected" : ""}`}><input type="radio" name="reconciliation-explanation" checked={selectedExplanation === option.id} onChange={() => handleExplanationChange(option.id)} /> <span>{option.label}</span></label>)}</div></div>
    {selectedExplanation && <div className="supporting-docs"><h3>Supporting evidence</h3><div className="document-options">{evidenceOptions.map((option) => <button key={option} type="button" className={documentType === option ? "selected" : ""} onClick={() => setDocumentType(option as SupportingDocumentType)}>{option.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</button>)}</div>{selectedFileName && <div className="selected-evidence-file"><FileText size={15} /><span>{selectedFileName}</span></div>}<div className={`evidence-upload-status ${uploadPhase}`} aria-live="polite">{uploadPhase === "uploading" ? "Uploading evidence..." : uploadPhase === "reading" ? "Reading supporting evidence..." : uploadPhase === "extracted" ? "Evidence extracted" : uploadPhase === "error" ? "We couldn't read the required information from this document." : ""}</div><button type="button" className="upload-button upload-button-inline" disabled={loading} onClick={() => fileInputRef.current?.click()}><UploadCloud size={15} /> {selectedFileName ? "Change file" : "Upload evidence"}</button><input ref={fileInputRef} className="native-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={loading} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void handleEvidenceSelection(file); event.currentTarget.value = ""; }} /></div>}
    <div className="correction"><button type="button" className="correction-toggle" onClick={() => { setCorrection(String(issue.declared_value)); setCorrectionOpen(true); }}>Update your application information <ArrowRight size={15} /></button>{correctionOpen && <div className="correction-editor"><p>Change the value you originally entered. This is separate from explaining the difference.</p><label htmlFor="correction">Current monthly income</label><strong>₹{Number(issue.declared_value).toLocaleString("en-IN")}</strong><label htmlFor="correction-new">New monthly income</label><div className="correction-input"><span>₹</span><input id="correction-new" inputMode="numeric" value={correction} onChange={(event) => setCorrection(event.target.value.replace(/[^0-9]/g, ""))} /><button onClick={onCorrect} disabled={loading || !correction}>{loading ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={17} />} Update application</button></div></div>}</div></section>; }
function VerifiedCard({ profile }: { profile: CanonicalProfile }) { return <section className="verified-card"><div className="verified-icon"><CheckCircle2 size={28} /></div><div><span className="verified-kicker">RE-VERIFIED</span><h2>Information verified</h2><p>Your provided information matches the uploaded evidence.</p><div className="verified-value"><span>Monthly income</span><strong>{formatMoney(profile.income.gross_monthly)}</strong></div></div></section>; }
function ErrorNotice({ message }: { message: string }) { return <div className="error-notice" role="alert"><TriangleAlert size={16} />{message}</div>; }

export default App;
