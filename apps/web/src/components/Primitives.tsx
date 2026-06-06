import type { ReactNode } from "react";
import type { Chip as ChipType, OwnerKind } from "../types/signalRoom";

interface ChipProps {
  chip: ChipType;
}

interface AvatarProps {
  initial: string;
  kind: OwnerKind;
}

interface OwnerLabelProps extends AvatarProps {
  label: string;
}

interface IconButtonLabelProps {
  children: ReactNode;
}

export function Chip({ chip }: ChipProps) {
  if (chip.href) {
    return (
      <a className={`chip ${chip.tone ?? "default"}`} href={chip.href} target="_blank" rel="noreferrer">
        {chip.label}
      </a>
    );
  }

  return <span className={`chip ${chip.tone ?? "default"}`}>{chip.label}</span>;
}

export function ChipRow({ chips }: { chips: ChipType[] }) {
  return (
    <div className="chip-row">
      {chips.map((chip) => (
        <Chip key={`${chip.label}-${chip.tone ?? "default"}`} chip={chip} />
      ))}
    </div>
  );
}

export function Avatar({ initial, kind }: AvatarProps) {
  return <span className={`avatar ${kind}`}>{initial}</span>;
}

export function OwnerLabel({ initial, kind, label }: OwnerLabelProps) {
  return (
    <span className="owner">
      <Avatar initial={initial} kind={kind} />
      {label}
    </span>
  );
}

export function PanelTitle({ children }: IconButtonLabelProps) {
  return <h2 className="panel-title">{children}</h2>;
}
