export function ApprovalChoice({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="field">
    <label className="approval-choice"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>Skip approval prompts</span></label>
    <small>{checked ? 'Commands run without approval prompts inside the workspace sandbox. Actions blocked by the sandbox fail instead of asking for approval.' : 'Codex can ask for approval when needed.'} Project and hook trust prompts still apply.</small>
  </div>;
}
