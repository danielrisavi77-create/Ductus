import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import LogoutDialog, { type LogoutDialogProps } from "@/components/editor/LogoutDialog";

type ScenarioProps = Pick<LogoutDialogProps, "plan" | "working" | "failed" | "copies"> & {
  /** How the discard of a copy settles in this preview. */
  discardFails?: boolean;
};

function LogoutScenario({ discardFails = false, copies, ...props }: ScenarioProps) {
  const [kept, setKept] = useState(copies ?? 0);
  const [open, setOpen] = useState(true);
  const [action, setAction] = useState("Još nije odabrana nijedna radnja.");

  const record = (label: string) => {
    setAction(label);
    setOpen(false);
  };

  return (
    <main style={{ padding: 24 }}>
      <h1>Pregled dijaloga odjave</h1>
      <p>Radnje se bilježe samo u ovom prikazu. Nema odjave ni preuzimanja datoteke.</p>
      <button type="button" onClick={() => setOpen(true)}>Otvori dijalog</button>
      <p role="status">{action}</p>
      {open && (
        <LogoutDialog
          {...props}
          onConfirm={() => record("Odabrano: Odjavi se.")}
          onStay={() => record("Odabrano: Ostani.")}
          onExport={() => record("Odabrano: Izvezi tekst.")}
          copies={kept}
          onRestoreCopy={() => record("Odabrano: Vrati tekst u rad.")}
          onDiscardCopy={async () => {
            if (discardFails) throw new Error("preview");
            setKept((n) => n - 1);
            setAction("Odabrano: Odbaci kopiju.");
          }}
        />
      )}
    </main>
  );
}

const meta = {
  title: "Demo/Odjava",
  component: LogoutScenario,
  render: (args, context) => <LogoutScenario key={context.id} {...args} />,
  args: {
    plan: { unsaved: false, pending: 0 },
    working: false,
    failed: false,
  },
} satisfies Meta<typeof LogoutScenario>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = { name: "Obična odjava" };

export const Pending: Story = {
  name: "Izmjene ostaju na uređaju",
  args: { plan: { unsaved: false, pending: 3 } },
};

export const Unsaved: Story = {
  name: "Nespremljeni tekst",
  args: { plan: { unsaved: true, pending: 3 } },
};

export const Working: Story = {
  name: "Odjava u tijeku",
  args: { plan: { unsaved: false, pending: 3 }, working: true },
};

export const Failed: Story = {
  name: "Odjava nije uspjela",
  args: { plan: { unsaved: false, pending: 3 }, failed: true },
};

export const Copy: Story = {
  name: "Kopija teksta ostaje",
  args: { plan: { unsaved: false, pending: 3 }, copies: 1 },
};

export const Copies: Story = {
  name: "Više kopija teksta",
  args: { plan: { unsaved: false, pending: 0 }, copies: 3 },
};

export const CopyDiscardFails: Story = {
  name: "Kopija nije odbačena",
  args: { plan: { unsaved: false, pending: 0 }, copies: 1, discardFails: true },
};
