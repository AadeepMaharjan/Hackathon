import { useEffect, useState } from "react";
import { triageApi } from "./triageApi";
import { URGENCY_META } from "./triage";
import { ResourcePanel } from "./ResourceBar";
import { UrgencySelector } from "./UrgencySelector";

export function IntakeRoute({ resources, onRefresh }) {
  const [form, setForm] = useState({ name: "", age: "", phone: "", problem: "", arrivalMode: "Walk-in", notes: "" });
  const [preview, setPreview] = useState({ level: null, matchedKeyword: null });
  const [override, setOverride] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!form.problem.trim()) { setPreview({ level: null, matchedKeyword: null }); return undefined; }
    const timer = setTimeout(async () => { try { setPreview(await triageApi.lookupUrgency(form.problem)); } catch { /* Retain current preview when API is unavailable. */ } }, 300);
    return () => clearTimeout(timer);
  }, [form.problem]);

  const activeLevel = override || preview.level;
  const updateField = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  async function submit(event) {
    event.preventDefault(); setError(null); setResult(null);
    if (!form.name.trim() || !form.problem.trim()) { setError("Name and problem are required."); return; }
    setSubmitting(true);
    try { const data = await triageApi.createPatient({ ...form, urgencyOverride: override }); setResult(data); setForm({ name: "", age: "", phone: "", problem: "", arrivalMode: "Walk-in", notes: "" }); setOverride(null); setPreview({ level: null, matchedKeyword: null }); onRefresh(); }
    catch (submissionError) { setError(`${submissionError.message} — is the backend running on http://localhost:4000?`); }
    finally { setSubmitting(false); }
  }
  return <><div className="hero"><div className="eyebrow">New arrival</div><h1 className="display">Who needs care right now?</h1><p>Enter the patient's details. Their condition is checked against a triage reference and assigned red, yellow, or green automatically — you can override it if a clinician's judgment differs.</p></div><div className="grid"><div className="card"><form onSubmit={submit}><div className="form-section-label">Patient details</div><div className="row2"><div className="field"><label>Patient name</label><input value={form.name} onChange={updateField("name")} placeholder="Name" /></div><div className="field"><label>Age</label><input type="number" min="0" max="130" value={form.age} onChange={updateField("age")} placeholder="Age" /></div></div><div className="row2"><div className="field"><label>Phone number</label><input value={form.phone} onChange={updateField("phone")} /></div><div className="field"><label>Arrival method</label><select value={form.arrivalMode} onChange={updateField("arrivalMode")}><option>Walk-in</option><option>Ambulance</option><option>Police / first responder</option><option>Inter-facility transfer</option></select></div></div><div className="form-section-label">Clinical assessment</div><div className="field"><label>Problem / condition</label><textarea value={form.problem} onChange={updateField("problem")} placeholder="e.g. severe chest pain and shortness of breath" />{preview.matchedKeyword && <div className="hint">Matched on "{preview.matchedKeyword}" in the triage reference</div>}</div><div className="field"><label>Brief notes <span className="optional">optional</span></label><textarea className="notes" value={form.notes} onChange={updateField("notes")} placeholder="Allergies, current observations, or any handover details" /></div><div className="urgency-preview"><span className="dot" style={{ background: activeLevel ? URGENCY_META[activeLevel].color : "var(--line)" }} /><span className="txt">{activeLevel ? <>Suggested priority: <b>{activeLevel}</b>{override && " (overridden)"}</> : "Priority will appear as you describe the condition"}</span></div><UrgencySelector activeLevel={activeLevel} onSelect={setOverride} />{error && <div className="banner wait">{error}</div>}{result && <div className={`banner ${result.patient.status === "admitted" ? "ok" : "wait"}`}><b>{result.patient.name}</b> is now <b>{result.patient.status}</b>{result.patient.status === "admitted" ? " with resources assigned." : ", waiting on capacity."}{result.bumpedPatients?.length > 0 && <div className="banner-detail">To make room: {result.bumpedPatients.map((patient) => `${patient.name} → ${patient.transferredTo}`).join(", ")}</div>}</div>}<button className="submit" type="submit" disabled={submitting}>{submitting ? "Adding to queue…" : "Add to priority queue"}</button></form></div><ResourcePanel resources={resources} /></div></>;
}
