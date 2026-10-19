'use client';
import type { HTMLAttributes } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { config } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import * as definitions from '@/lib/control/pro-icons';
config.autoAddCss = false;
const icon = (definition: IconDefinition) =>
  function Icon({
    size,
    strokeWidth: _strokeWidth,
    ...props
  }: HTMLAttributes<HTMLOrSVGElement> & { size?: number; strokeWidth?: number | string }) {
    return (
      <FontAwesomeIcon
        {...props}
        icon={definition}
        aria-hidden="true"
        style={{ width: size ?? '1.25em', height: size ?? '1.25em', ...props.style }}
      />
    );
  };
export const Eye = icon(definitions.faEye);
export const EyeOff = icon(definitions.faEyeSlash);
export const HelpCircle = icon(definitions.faCircleQuestion);
export const InfoCircle = icon(definitions.faCircleInfo);
export const ChevronDown = icon(definitions.faChevronDown);
export const ChevronRight = icon(definitions.faChevronRight);
export const Activity = icon(definitions.faWavePulse);
export const ArrowUpRight = icon(definitions.faArrowUpRight);
export const Building2 = icon(definitions.faBuilding);
export const Check = icon(definitions.faCheck);
export const KeyRound = icon(definitions.faKey);
export const Link2 = icon(definitions.faLink);
export const Plus = icon(definitions.faPlus);
export const ShieldCheck = icon(definitions.faShieldCheck);
export const Users = icon(definitions.faUsers);
export const X = icon(definitions.faXmark);
export const ArrowDown = icon(definitions.faArrowDown);
export const ChevronSelectorVertical = icon(definitions.faSort);
export const Copy01 = icon(definitions.faCopy);
export const Edit01 = icon(definitions.faPen);
export const Trash01 = icon(definitions.faTrash);
export const DotsVertical = icon(definitions.faEllipsisVertical);
export const User01 = icon(definitions.faUser);
export const SearchLg = icon(definitions.faMagnifyingGlass);
export const ChevronUp = icon(definitions.faChevronUp);
export const Minus = icon(definitions.faMinus);
export const XClose = icon(definitions.faXmark);
export const Bell = icon(definitions.faBell);
export const MenuIcon = icon(definitions.faBars);
export const WorkflowIcon = icon(definitions.faDiagramProject);
export const ArrowRightIcon = icon(definitions.faArrowRight);
export const UploadIcon = icon(definitions.faArrowUpFromBracket);

export const SettingsIcon = icon(definitions.faGear);
