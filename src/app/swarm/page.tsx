import type { Metadata } from "next";
import { SwarmPage } from "@/components/swarm/swarm-page";
import "./swarm.css";
export const metadata: Metadata = { title: "Swarm · PAI", description: "Batch address prospecting, deduplicated businesses, geographic clusters and public business research." };
export default function SwarmRoute() { return <SwarmPage/>; }
