'use client';
import { createContext, useContext } from 'react';
import type { MappingTarget } from '@/lib/authoring/contracts';
export const MappingContext = createContext<{
  target: MappingTarget | null;
  openPicker?: (target: MappingTarget) => void;
  readOnly: boolean;
  requestInsert: (expression: string) => void;
  suggestions: { label: string; displayLabel?: string; info?: string }[];
  preview?: (expression: string) => { value?: unknown; error?: string };
  setTarget: (target: MappingTarget) => void;
}>({ target: null, readOnly: false, setTarget: () => {}, requestInsert: () => {}, suggestions: [] });
export const useMapping = () => useContext(MappingContext);
