// Reference triage table, modeled on standard Emergency Severity Index (ESI)
// conventions used by hospitals. This is a static local reference set rather
// than a live lookup — there is no network access in this environment to
// query Google or a live medical API, so the mapping below stands in for
// that step. Swap `lookupUrgency` for a real call to a clinical triage API
// or search service if one becomes available.
//
// red    = immediate / life-threatening, needs ICU-level resources now
// yellow = urgent, needs prompt attention but is stable for a short wait
// green  = non-urgent, can safely wait, minimal resource draw

const TRIAGE_TABLE = [
  { level: "red", keywords: ["cardiac arrest", "heart attack", "myocardial infarction", "stroke", "severe bleeding", "hemorrhage", "gunshot", "stab wound", "major trauma", "not breathing", "no pulse", "unconscious", "severe burn", "anaphylaxis", "septic shock", "sepsis", "respiratory failure", "choking", "drowning", "severe head injury", "spinal injury", "multiple fractures", "internal bleeding", "overdose", "poisoning", "ruptured appendix", "aortic aneurysm", "seizure (ongoing)", "status epilepticus"] },
  { level: "yellow", keywords: ["chest pain", "difficulty breathing", "shortness of breath", "high fever", "fracture", "broken bone", "dehydration", "asthma attack", "abdominal pain", "appendicitis", "deep laceration", "moderate burn", "allergic reaction", "diabetic emergency", "high blood sugar", "low blood sugar", "kidney stone", "miscarriage", "pregnancy complication", "concussion", "dizziness", "fainting", "persistent vomiting", "dehydration", "infection", "pneumonia", "uti", "urinary tract infection", "migraine"] },
  { level: "green", keywords: ["cold", "flu", "cough", "sore throat", "minor cut", "sprain", "bruise", "rash", "headache", "mild fever", "allergy", "ear ache", "toothache", "back pain", "minor burn", "insect bite", "constipation", "mild nausea", "check-up", "checkup", "follow-up", "follow up", "vaccination", "prescription refill", "mild pain", "stomach ache", "diarrhea"] }
];

function lookupUrgency(diseaseText) {
  const text = (diseaseText || "").toLowerCase().trim();
  if (!text) return { level: null, matchedKeyword: null };

  // Check red first, then yellow, then green — most severe match wins if a
  // description happens to contain words from more than one tier.
  for (const tier of TRIAGE_TABLE) {
    for (const keyword of tier.keywords) {
      if (text.includes(keyword)) {
        return { level: tier.level, matchedKeyword: keyword };
      }
    }
  }
  // Unknown description: default to yellow so an unrecognized complaint is
  // never silently treated as low-priority.
  return { level: "yellow", matchedKeyword: null };
}

export { TRIAGE_TABLE, lookupUrgency };
