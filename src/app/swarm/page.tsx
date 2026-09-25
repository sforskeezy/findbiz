import type { Metadata } from "next";
import { SwarmPage } from "@/components/swarm/swarm-page";
import "./swarm.css";
import "./workspace.css";
export const metadata: Metadata = { title: "Swarm · PAI", description: "Batch address prospecting, geographic clusters, and a sales funnel for imported leads and follow-ups." };
export default function SwarmRoute() { return <SwarmPage/>; }
