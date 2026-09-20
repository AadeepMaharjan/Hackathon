const request = async (path, options) => {
  const response = await fetch(`/api${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
};

export const triageApi = {
  getResources: () => request("/resources"), getPatients: () => request("/patients"), getTransfers: () => request("/transfers"),
  lookupUrgency: (problem) => request("/lookup-urgency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problem }) }),
  createPatient: (patient) => request("/patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patient) }),
  removePatient: (id) => request(`/patients/${id}`, { method: "DELETE" }),
  getHospitals: () => request("/hospitals"),
  transferPatient: (id, hospitalName) => request(`/patients/${id}/transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hospitalName }) }),
  dischargePatient: (id) => request(`/patients/${id}/discharge`, { method: "POST" }),
  completeOperation: (id) => request(`/patients/${id}/complete-operation`, { method: "POST" }),
  markDeceased: (id) => request(`/patients/${id}/deceased`, { method: "POST" }),
  returnPatient: (id) => request(`/patients/${id}/return`, { method: "POST" }),
  movePatientUnit: (id, destination) => request(`/patients/${id}/move-unit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination }) })
};
