"use client";
import { useRouter } from "next/navigation";
import type { CompanionRegion } from "@/lib/region";
export function PatchSelect({patches,selected,region}:{patches:string[];selected:string;region:CompanionRegion}){const router=useRouter();return <label className="patch-select">Patch<select value={selected} onChange={(event)=>router.push(`/tier-list?region=${region}&patch=${encodeURIComponent(event.target.value)}`)}>{patches.map((patch)=><option value={patch} key={patch}>{patch}</option>)}</select></label>;}
