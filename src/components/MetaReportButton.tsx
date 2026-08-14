"use client";
import { useState } from "react";
import type { CompanionRegion } from "@/lib/region";
export function MetaReportButton({region}:{region:CompanionRegion}){const[message,setMessage]=useState("");async function copy(){const response=await fetch(`/api/meta-report?region=${region}`,{cache:"no-store"});const payload=await response.json() as {report?:string};if(!payload.report)return setMessage("No report is available yet.");await navigator.clipboard.writeText(payload.report);setMessage("Meta report copied.");}return <div className="meta-report-action"><button type="button" onClick={()=>void copy()}>Copy Meta Report</button>{message&&<small>{message}</small>}</div>;}
