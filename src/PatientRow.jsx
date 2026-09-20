import { useEffect, useState } from "react";

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${remainder}s`;
  return `${minutes}m ${remainder}s`;
}

export function PatientRow({ patient, selected, onClick }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, []);
  const { name, urgency, age, problem, status, transferredTo, arrivalMode, estimatedTreatmentMinutes, estimatedWaitMinutes, treatmentEndsAt, ambulanceAvailableAt, ambulanceArrivalAt, careStage, operationEndsAt, operationMinutes, opdTreatmentMinutes, location, bedNumber, icuNumber, operatingRoomNumber, opdNumber } = patient;
  const treatmentRemaining = treatmentEndsAt ? new Date(treatmentEndsAt).getTime() - now : null;
  const operationRemaining = operationEndsAt ? new Date(operationEndsAt).getTime() - now : null;
  const placement = operatingRoomNumber ? `Theatre ${operatingRoomNumber}` : opdNumber ? `OPD ${opdNumber}` : icuNumber ? `ICU ${icuNumber}` : bedNumber ? `Bed ${bedNumber}` : location;
  const ambulanceMinutes = ambulanceAvailableAt ? Math.max(0, Math.ceil((new Date(ambulanceAvailableAt).getTime() - now) / 60_000)) : null;
  const ambulanceArrivalMinutes = ambulanceArrivalAt ? Math.max(0, Math.ceil((new Date(ambulanceArrivalAt).getTime() - now) / 60_000)) : null;
  return <button type="button" className={`patient ${selected ? "selected" : ""}`} onClick={onClick}><div className="p-top"><span className="p-name">{name}</span><span className={`badge ${urgency}`}>{urgency}</span></div><div className="p-meta">{age ? `${age} yrs · ` : ""}{problem}</div><div className="status-line"><span className={`status-dot ${status}`} />{status === "admitted" && careStage === "operation" && <span>Operation · {formatDuration(operationRemaining)} remaining</span>}{status === "admitted" && careStage === "opd" && <span>OPD recovery · {formatDuration(treatmentRemaining)} remaining</span>}{status === "admitted" && careStage !== "operation" && careStage !== "opd" && <span>In treatment · {formatDuration(treatmentRemaining)} remaining</span>}{status === "waiting" && <span>Waiting · ~{formatDuration((estimatedWaitMinutes ?? 0) * 60_000)}</span>}{status === "transferred" && <span>Transferred to {transferredTo}</span>}{status === "discharged" && <span>Discharged · resources released</span>}{status === "deceased" && <span>Recorded deceased</span>}{arrivalMode && <em>{arrivalMode}</em>}</div>{status === "admitted" && <div className="placement">Location: {placement}</div>}{status === "waiting" && arrivalMode === "Ambulance" && ambulanceMinutes > 0 && <div className="ambulance-countdown">Ambulance available in ~{ambulanceMinutes} min</div>}{status === "transferred" && ambulanceArrivalMinutes > 0 && <div className="ambulance-countdown">Ambulance arriving in ~{ambulanceArrivalMinutes} min</div>}{status !== "deceased" && careStage === "operation" && <div className="treatment-estimate">Estimated operation: ~{formatDuration(operationMinutes * 60_000)}</div>}{status !== "deceased" && careStage === "opd" && <div className="treatment-estimate">Estimated OPD recovery: ~{formatDuration(opdTreatmentMinutes * 60_000)}</div>}{status !== "deceased" && !operationMinutes && estimatedTreatmentMinutes && <div className="treatment-estimate">Estimated treatment: ~{formatDuration(estimatedTreatmentMinutes * 60_000)}</div>}</button>;
}
