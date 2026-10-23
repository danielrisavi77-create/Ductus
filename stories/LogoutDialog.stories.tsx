import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import LogoutDialog, { type LogoutDialogProps } from "@/components/editor/LogoutDialog";

type ScenarioProps = Pick<LogoutDialogProps, "plan" | "working" | "failed">;

function LogoutScenario(props: ScenarioProps) {
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
