import Link from "next/link";
import type { CompanionRegion } from "@/lib/region";

export function RegionToggle({ region, pathname, extra = {} }: { region:CompanionRegion;pathname:string;extra?:Record<string,string|number> }) {
  return <nav className="region-toggle" aria-label="Data region">{(["na","kr","global"] as const).map((value)=>{const query=new URLSearchParams({ ...Object.fromEntries(Object.entries(extra).map(([key,item])=>[key,String(item)])),region:value });return <Link className={value===region?"active":""} href={`${pathname}?${query}`} key={value}>{value.toUpperCase()}</Link>;})}</nav>;
}
