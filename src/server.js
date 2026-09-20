import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TRIAGE_TABLE, lookupUrgency } from "./diseaseMap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "db.json");
const app = express();
app.use(cors());
app.use(express.json());

// ---------- tiny file-backed "database" (db.json) ----------
function readDb() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  if (!db.resources.opdSeats) db.resources.opdSeats = { total: 12, available: 12 };
  if (!db.ambulanceDispatches) db.ambulanceDispatches = [];
  return db;
}
function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---------- resource requirements per urgency level ----------
const REQUIREMENTS = {
  red: { icuBeds: 1, doctors: 1, nurses: 1 },
  yellow: { beds: 1, doctors: 1 },
  green: { beds: 1 }
};
const URGENCY_RANK = { red: 3, yellow: 2, green: 1 };

// Red patients and ambulance arrivals reserve a vehicle for active emergency
// response. The vehicle is returned when the patient is removed or transferred.
function getRequirements(urgency, arrivalMode, problem = "") {
  const requirements = { ...REQUIREMENTS[urgency] };
  if (needsOperation(problem)) {
    delete requirements.beds;
    delete requirements.icuBeds;
    requirements.operatingRooms = 1;
  }
  if (urgency === "red" || arrivalMode === "Ambulance") requirements.emergencyVehicles = 1;
  return requirements;
}

function canAllocate(reqs, resources) {
  return Object.entries(reqs).every(([key, amt]) => resources[key].available >= amt);
}
function applyAllocation(reqs, resources, sign) {
  // sign = -1 to consume, +1 to release
  Object.entries(reqs).forEach(([key, amt]) => {
    resources[key].available += sign * amt;
  });
}

function dispatchEmergencyVehicle(db, travelMinutes = 25) {
  if (db.resources.emergencyVehicles.available < 1) return false;
  db.resources.emergencyVehicles.available -= 1;
  const arrivalAt = new Date(Date.now() + travelMinutes * 60_000).toISOString();
  db.ambulanceDispatches.push({ arrivalAt });
  return { arrivalAt, travelMinutes };
}

function pickNearbyHospital(db, preferICU) {
  const sorted = [...db.nearbyHospitals].sort((a, b) => a.distanceKm - b.distanceKm);
  if (preferICU) {
    const icuMatch = sorted.find((h) => h.hasICU);
    if (icuMatch) return icuMatch;
  }
  return sorted[0];
}

// Demonstration estimates only — not clinical advice or real treatment plans.
const TREATMENT_PLANS = [
  { keywords: ["major surgery", "organ failure", "septic shock", "severe burn", "spinal injury"], minutes: 4320 },
  { keywords: ["heart attack", "cardiac arrest", "stroke", "sepsis", "major trauma"], minutes: 720 },
  { keywords: ["fracture", "pneumonia", "appendicitis", "asthma attack"], minutes: 180 },
  { keywords: ["cold", "flu", "sprain", "rash", "minor cut"], minutes: 25 }
];
const DEFAULT_TREATMENT_MINUTES = { red: 120, yellow: 75, green: 35 };
const OPERATION_PLANS = [
  { keywords: ["heart attack", "major trauma", "severe bleeding", "internal bleeding"], operationMinutes: 240, opdMinutes: 1440 },
  { keywords: ["appendicitis", "ruptured appendix", "fracture", "broken bone"], operationMinutes: 120, opdMinutes: 720 },
  { keywords: ["major surgery", "severe burn", "spinal injury"], operationMinutes: 300, opdMinutes: 2880 }
];

function getOperationPlan(problem) {
  const description = (problem || "").toLowerCase();
  return OPERATION_PLANS.find((plan) => plan.keywords.some((keyword) => description.includes(keyword))) || null;
}

function needsOperation(problem) {
  return Boolean(getOperationPlan(problem));
}

function nextNumber(db, field, total) {
  const occupied = new Set(db.patients.filter((patient) => patient.status === "admitted" && patient[field]).map((patient) => patient[field]));
  for (let number = 1; number <= total; number += 1) if (!occupied.has(number)) return number;
  return null;
}

function setPlacement(patient, db) {
  patient.bedNumber = null;
  patient.icuNumber = null;
  patient.operatingRoomNumber = null;
  patient.opdNumber = null;
  if (patient.careStage === "operation") {
    patient.location = "Operating theatre";
    patient.operatingRoomNumber = nextNumber(db, "operatingRoomNumber", db.resources.operatingRooms.total);
  } else if (patient.careStage === "opd") {
    patient.location = "OPD recovery";
    patient.opdNumber = nextNumber(db, "opdNumber", db.resources.opdSeats.total);
  } else if (patient.careStage === "icu" || (patient.urgency === "red" && patient.careStage !== "general")) {
    patient.location = "ICU";
    patient.icuNumber = nextNumber(db, "icuNumber", db.resources.icuBeds.total);
  } else {
    patient.location = "General ward";
    patient.bedNumber = nextNumber(db, "bedNumber", db.resources.beds.total);
  }
}

function movePatientUnit(patient, db, destination) {
  if (patient.status !== "admitted" || ["operation", "opd"].includes(patient.careStage)) return { error: "only general-bed or ICU patients can be moved" };
  const originalRequirements = patient.assignedResources;
  const destinationRequirements = destination === "icu" ? { icuBeds: 1, doctors: 1, nurses: 1 } : { beds: 1 };
  if (originalRequirements.emergencyVehicles) destinationRequirements.emergencyVehicles = 1;
  applyAllocation(originalRequirements, db.resources, +1);
  if (!canAllocate(destinationRequirements, db.resources)) {
    applyAllocation(originalRequirements, db.resources, -1);
    return { error: destination === "icu" ? "no ICU capacity is available" : "no general bed is available" };
  }
  applyAllocation(destinationRequirements, db.resources, -1);
  patient.assignedResources = destinationRequirements;
  patient.careStage = destination;
  setPlacement(patient, db);
  return { patient };
}

function getTreatmentMinutes(problem, urgency) {
  const description = (problem || "").toLowerCase();
  const plan = TREATMENT_PLANS.find((entry) => entry.keywords.some((keyword) => description.includes(keyword)));
  return plan?.minutes || DEFAULT_TREATMENT_MINUTES[urgency];
}

function getAmbulanceAvailableAt(db) {
  if (db.resources.emergencyVehicles.available > 0) return new Date().toISOString();
  const assignedVehicles = db.patients
    .filter((patient) => patient.status === "admitted" && patient.assignedResources?.emergencyVehicles && patient.treatmentEndsAt)
    .map((patient) => new Date(patient.treatmentEndsAt).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return assignedVehicles.length ? new Date(assignedVehicles[0]).toISOString() : null;
}

function admitPatient(patient, db) {
  const requirements = getRequirements(patient.urgency, patient.arrivalMode, patient.problem);
  if (!canAllocate(requirements, db.resources)) return false;
  applyAllocation(requirements, db.resources, -1);
  const operationPlan = getOperationPlan(patient.problem);
  const minutes = patient.estimatedTreatmentMinutes || getTreatmentMinutes(patient.problem, patient.urgency);
  patient.status = "admitted";
  patient.assignedResources = requirements;
  patient.estimatedTreatmentMinutes = minutes;
  patient.estimatedWaitMinutes = 0;
  patient.careStage = operationPlan ? "operation" : "treatment";
  patient.operationMinutes = operationPlan?.operationMinutes || null;
  patient.opdTreatmentMinutes = operationPlan?.opdMinutes || null;
  patient.operationEndsAt = operationPlan ? new Date(Date.now() + operationPlan.operationMinutes * 60_000).toISOString() : null;
  patient.treatmentEndsAt = operationPlan ? null : new Date(Date.now() + minutes * 60_000).toISOString();
  patient.transferredTo = null;
  setPlacement(patient, db);
  return true;
}

function updateWaitingEstimates(db) {
  const waitingPatients = db.patients
    .filter((patient) => patient.status === "waiting")
    .sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency] || new Date(a.arrivalTime) - new Date(b.arrivalTime));
  let projectedDelay = 0;
  let changed = false;
  waitingPatients.forEach((patient) => {
    const priorityBuffer = patient.urgency === "red" ? 0 : patient.urgency === "yellow" ? 15 : 35;
    const estimate = Math.round(priorityBuffer + projectedDelay);
    if (patient.estimatedWaitMinutes !== estimate) {
      patient.estimatedWaitMinutes = estimate;
      changed = true;
    }
    projectedDelay += getTreatmentMinutes(patient.problem, patient.urgency) / 4;
    if (patient.arrivalMode === "Ambulance") {
      const ambulanceAvailableAt = getAmbulanceAvailableAt(db);
      if (patient.ambulanceAvailableAt !== ambulanceAvailableAt) {
        patient.ambulanceAvailableAt = ambulanceAvailableAt;
        changed = true;
      }
    }
  });
  return changed;
}

function processPatientFlow(db) {
  let changed = false;
  const now = Date.now();
  const activeDispatches = [];
  db.ambulanceDispatches.forEach((dispatch) => {
    if (new Date(dispatch.arrivalAt).getTime() <= now) {
      db.resources.emergencyVehicles.available += 1;
      changed = true;
    } else activeDispatches.push(dispatch);
  });
  db.ambulanceDispatches = activeDispatches;
  db.patients.forEach((patient) => {
    if (patient.status !== "admitted") return;
    if (!patient.careStage) {
      patient.careStage = "treatment";
      setPlacement(patient, db);
      changed = true;
    }
    if (patient.careStage === "operation" && patient.operationEndsAt && new Date(patient.operationEndsAt).getTime() <= now) {
      if (moveToOpd(patient, db)) changed = true;
      return;
    }
    if (!patient.treatmentEndsAt) {
      patient.estimatedTreatmentMinutes = patient.estimatedTreatmentMinutes || getTreatmentMinutes(patient.problem, patient.urgency);
      patient.treatmentEndsAt = new Date(now + patient.estimatedTreatmentMinutes * 60_000).toISOString();
      changed = true;
    }
    if (new Date(patient.treatmentEndsAt).getTime() <= now) {
      applyAllocation(patient.assignedResources, db.resources, +1);
      patient.status = "discharged";
      patient.assignedResources = {};
      patient.location = "Discharged";
      patient.bedNumber = null;
      patient.icuNumber = null;
      patient.operatingRoomNumber = null;
      patient.opdNumber = null;
      patient.dischargedAt = new Date(now).toISOString();
      changed = true;
    }
  });

  const waitingPatients = db.patients
    .filter((patient) => patient.status === "waiting")
    .sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency] || new Date(a.arrivalTime) - new Date(b.arrivalTime));
  waitingPatients.forEach((patient) => { if (admitPatient(patient, db)) changed = true; });
  return updateWaitingEstimates(db) || changed;
}

function moveToOpd(patient, db) {
  if (patient.careStage !== "operation" || db.resources.opdSeats.available < 1) return false;
  applyAllocation({ operatingRooms: 1 }, db.resources, +1);
  applyAllocation({ opdSeats: 1 }, db.resources, -1);
  patient.assignedResources = { ...patient.assignedResources, operatingRooms: 0, opdSeats: 1 };
  patient.careStage = "opd";
  patient.operationEndsAt = null;
  patient.treatmentEndsAt = new Date(Date.now() + patient.opdTreatmentMinutes * 60_000).toISOString();
  setPlacement(patient, db);
  return true;
}

function releasePatientResources(patient, db, finalStatus) {
  if (patient.assignedResources) applyAllocation(patient.assignedResources, db.resources, +1);
  patient.assignedResources = {};
  patient.status = finalStatus;
  patient.location = finalStatus === "discharged" ? "Discharged" : finalStatus === "deceased" ? "Deceased" : "Transferred";
  patient.bedNumber = null;
  patient.icuNumber = null;
  patient.operatingRoomNumber = null;
  patient.opdNumber = null;
  patient.treatmentEndsAt = null;
  patient.operationEndsAt = null;
}

function readProcessedDb() {
  const db = readDb();
  if (processPatientFlow(db)) writeDb(db);
  return db;
}

// A released slot is offered back to one transferred patient at a time.
// The most urgent, longest-waiting suitable patient gets the first opening.
function restoreNextTransferredPatient(db, removedUrgency) {
  const candidates = db.patients
    .filter((patient) => patient.status === "transferred" && URGENCY_RANK[patient.urgency] < URGENCY_RANK[removedUrgency])
    .sort((a, b) => {
      if (URGENCY_RANK[a.urgency] !== URGENCY_RANK[b.urgency]) {
        return URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency];
      }
      return new Date(a.arrivalTime) - new Date(b.arrivalTime);
    });

  const returningPatient = candidates.find((patient) => canAllocate(getRequirements(patient.urgency, patient.arrivalMode, patient.problem), db.resources));
  if (!returningPatient) return null;
  admitPatient(returningPatient, db);
  returningPatient.transferReason = "Returned after higher-priority capacity was released";
  return returningPatient;
}

// Try to free up enough resources for an incoming RED patient by
// transferring out the lowest-priority currently admitted patients
// (green before yellow, oldest arrival first within a tier).
function bumpLowerPriorityPatients(db, reqs) {
  const bumped = [];
  const candidates = db.patients
    .filter((p) => p.status === "admitted" && p.urgency !== "red")
    .sort((a, b) => {
      if (URGENCY_RANK[a.urgency] !== URGENCY_RANK[b.urgency]) {
        return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]; // green(1) before yellow(2)
      }
      return new Date(a.arrivalTime) - new Date(b.arrivalTime); // oldest first
    });

  const candidate = candidates.find((patient) => Object.values(patient.assignedResources || {}).some(Boolean));
  if (candidate && !canAllocate(reqs, db.resources)) {
    applyAllocation(candidate.assignedResources, db.resources, +1); // release one patient's resources
    const dispatch = dispatchEmergencyVehicle(db);
    if (!dispatch) {
      applyAllocation(candidate.assignedResources, db.resources, -1);
      return bumped;
    }
    candidate.status = "transferred";
    const hospital = pickNearbyHospital(db, candidate.urgency === "yellow");
    candidate.transferredTo = hospital.name;
    candidate.transferReason = "Bed/resource reassigned to a higher-priority (red) patient";
    candidate.assignedResources = {};
    candidate.ambulanceArrivalAt = dispatch.arrivalAt;
    db.transferLog.push({
      patientId: candidate.id,
      patientName: candidate.name,
      urgency: candidate.urgency,
      transferredTo: hospital.name,
      distanceKm: hospital.distanceKm,
      transport: "Emergency vehicle",
      timestamp: new Date().toISOString()
    });
    bumped.push(candidate);
  }
  return bumped;
}

// ---------- routes ----------
app.get("/api/disease-map", (req, res) => {
  res.json(TRIAGE_TABLE);
});

app.post("/api/lookup-urgency", (req, res) => {
  const { problem } = req.body;
  res.json(lookupUrgency(problem));
});

app.get("/api/resources", (req, res) => {
  res.json(readProcessedDb().resources);
});

app.get("/api/patients", (req, res) => {
  res.json(readProcessedDb().patients);
});

app.get("/api/transfers", (req, res) => {
  res.json(readProcessedDb().transferLog);
});

app.get("/api/hospitals", (req, res) => {
  res.json(readDb().nearbyHospitals.sort((a, b) => a.distanceKm - b.distanceKm));
});

app.post("/api/patients/:id/complete-operation", (req, res) => {
  const db = readDb();
  const patient = db.patients.find((entry) => entry.id === req.params.id);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  if (!moveToOpd(patient, db)) return res.status(409).json({ error: "an OPD recovery seat is required before completing the operation" });
  writeDb(db);
  res.json({ patient, resources: db.resources });
});

app.post("/api/patients/:id/discharge", (req, res) => {
  const db = readDb();
  const patient = db.patients.find((entry) => entry.id === req.params.id);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  if (patient.status !== "admitted") return res.status(400).json({ error: "only admitted patients can be discharged" });
  releasePatientResources(patient, db, "discharged");
  patient.dischargedAt = new Date().toISOString();
  processPatientFlow(db);
  writeDb(db);
  res.json({ patient, resources: db.resources });
});

app.post("/api/patients/:id/deceased", (req, res) => {
  const db = readDb();
  const patient = db.patients.find((entry) => entry.id === req.params.id);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  if (patient.status !== "admitted") return res.status(400).json({ error: "only admitted patients can be marked deceased" });
  releasePatientResources(patient, db, "deceased");
  patient.deceasedAt = new Date().toISOString();
  processPatientFlow(db);
  writeDb(db);
  res.json({ patient, resources: db.resources });
});

app.post("/api/patients/:id/return", (req, res) => {
  const db = readDb();
  const patient = db.patients.find((entry) => entry.id === req.params.id);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  if (patient.status !== "transferred") return res.status(400).json({ error: "only transferred patients can return" });
  if (!admitPatient(patient, db)) return res.status(409).json({ error: "required local resources are not available yet" });
  patient.transferReason = "Returned from transferred hospital";
  processPatientFlow(db);
  writeDb(db);
  res.json({ patient, resources: db.resources });
});

app.post("/api/patients/:id/move-unit", (req, res) => {
  const db = readDb();
  const patient = db.patients.find((entry) => entry.id === req.params.id);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  if (!["icu", "general"].includes(req.body.destination)) return res.status(400).json({ error: "destination must be ICU or general bed" });
  const result = movePatientUnit(patient, db, req.body.destination);
  if (result.error) return res.status(409).json({ error: result.error });
  writeDb(db);
  res.json({ patient, resources: db.resources });
});

app.delete("/api/patients/:id", (req, res) => {
  const db = readDb();
  const patientIndex = db.patients.findIndex((patient) => patient.id === req.params.id);
  if (patientIndex === -1) return res.status(404).json({ error: "patient not found" });

  const [patient] = db.patients.splice(patientIndex, 1);
  if (patient.status === "admitted" && patient.assignedResources) {
    applyAllocation(patient.assignedResources, db.resources, +1);
  }
  const returnedPatient = patient.status === "admitted" ? restoreNextTransferredPatient(db, patient.urgency) : null;
  processPatientFlow(db);
  writeDb(db);
  res.json({ removedPatient: patient, returnedPatient, resources: db.resources });
});

app.post("/api/patients/:id/transfer", (req, res) => {
  const db = readDb();
  const patient = db.patients.find((entry) => entry.id === req.params.id);
  const requestedHospital = db.nearbyHospitals.find((hospital) => hospital.name === req.body.hospitalName);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  if (!["waiting", "admitted"].includes(patient.status)) return res.status(400).json({ error: "only waiting or admitted patients can be transferred" });
  const hospital = requestedHospital || pickNearbyHospital(db, patient.urgency === "red");
  if (patient.status === "admitted") releasePatientResources(patient, db, "transferred");
  const dispatch = dispatchEmergencyVehicle(db);
  if (!dispatch) return res.status(409).json({ error: "no emergency vehicle is currently available for transfer" });
  if (patient.status !== "transferred") patient.status = "transferred";
  patient.transferredTo = hospital.name;
  patient.transferReason = "No local capacity available";
  patient.ambulanceArrivalAt = dispatch.arrivalAt;
  db.transferLog.push({
    patientId: patient.id,
    patientName: patient.name,
    urgency: patient.urgency,
    transferredTo: hospital.name,
    distanceKm: hospital.distanceKm,
    transport: "Emergency vehicle",
    ambulanceArrivalAt: dispatch.arrivalAt,
    timestamp: new Date().toISOString()
  });
  processPatientFlow(db);
  writeDb(db);
  res.json({ patient, hospital });
});

app.post("/api/patients", (req, res) => {
  const { name, age, phone, problem, urgencyOverride, arrivalMode, notes } = req.body;
  if (!name || !problem) {
    return res.status(400).json({ error: "name and problem are required" });
  }

  const db = readDb();
  const auto = lookupUrgency(problem);
  const urgency = urgencyOverride || auto.level || "yellow";
  const reqs = getRequirements(urgency, arrivalMode, problem);

  const patient = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    age: age || null,
    phone: phone || null,
    arrivalMode: arrivalMode || "Walk-in",
    notes: notes || null,
    problem,
    urgency,
    matchedKeyword: auto.matchedKeyword,
    arrivalTime: new Date().toISOString(),
    status: "waiting",
    assignedResources: {},
    transferredTo: null,
    estimatedTreatmentMinutes: getTreatmentMinutes(problem, urgency),
    estimatedWaitMinutes: null,
    treatmentEndsAt: null,
    ambulanceAvailableAt: arrivalMode === "Ambulance" ? getAmbulanceAvailableAt(db) : null,
    careStage: null,
    location: "Waiting area",
    bedNumber: null,
    icuNumber: null,
    operatingRoomNumber: null,
    opdNumber: null,
    operationMinutes: null,
    operationEndsAt: null,
    opdTreatmentMinutes: null
  };

  let bumpedPatients = [];
  if (canAllocate(reqs, db.resources)) {
    admitPatient(patient, db);
  } else if (urgency === "red") {
    bumpedPatients = bumpLowerPriorityPatients(db, reqs);
    if (canAllocate(reqs, db.resources)) {
      admitPatient(patient, db);
    } else {
      patient.status = "waiting"; // even after bumping, no lower-priority beds left to free
    }
  }

  db.patients.push(patient);
  processPatientFlow(db);
  writeDb(db);

  res.status(201).json({ patient, bumpedPatients, resources: db.resources });
});

const PORT = process.env.PORT || 4000;
setInterval(() => {
  const db = readDb();
  if (processPatientFlow(db)) writeDb(db);
}, 15_000);
app.listen(PORT, () => {
  console.log(`Hospital triage API running on http://localhost:${PORT}`);
});
