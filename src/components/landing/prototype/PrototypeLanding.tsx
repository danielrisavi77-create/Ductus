"use client";

import { useEffect, useRef } from "react";

import { landingPrototypeCopy } from "@/lib/i18n/landingPrototypeCopy";

import { initPrototype } from "./prototype-interactions";
import PrototypeMarkup from "./PrototypeMarkup";
import "./PrototypeLanding.css";

export default function PrototypeLanding() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    return initPrototype(root.current, landingPrototypeCopy);
  }, []);

  return <div className="ducturaPrototype" ref={root}><PrototypeMarkup /></div>;
}
