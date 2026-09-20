import { useCallback, useEffect, useState } from "react";
import { triageApi } from "./triageApi";
import { Header } from "./Header";
import { DashboardRoute } from "./DashboardRoute";
import { IntakeRoute } from "./IntakeRoute";

export default function App() {
  const [tab, setTab] = useState("intake"); const [resources, setResources] = useState(null); const [patients, setPatients] = useState([]); const [transfers, setTransfers] = useState([]);
  const refresh = useCallback(async () => { const [nextResources, nextPatients, nextTransfers] = await Promise.all([triageApi.getResources(), triageApi.getPatients(), triageApi.getTransfers()]); setResources(nextResources); setPatients(nextPatients); setTransfers(nextTransfers); }, []);
  useEffect(() => {
    refresh().catch(() => {});
    const interval = setInterval(() => refresh().catch(() => {}), 15_000);
    return () => clearInterval(interval);
  }, [refresh]);
  const changeTab = (nextTab) => { setTab(nextTab); if (nextTab === "dashboard") refresh().catch(() => {}); };
  return <main className="app"><Header tab={tab} onTabChange={changeTab} />{tab === "intake" ? <IntakeRoute resources={resources} onRefresh={() => refresh().catch(() => {})} /> : <DashboardRoute resources={resources} patients={patients} transfers={transfers} onRefresh={() => refresh().catch(() => {})} />}</main>;
}
