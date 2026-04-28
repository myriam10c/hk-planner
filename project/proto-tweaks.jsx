// Tweaks panel for the prototype.

const ProtoTweaks = () => {
  const { tweaks, setTweaks, role, setRole, goto } = useStore();

  React.useEffect(() => {
    document.body.classList.toggle('dense', tweaks.density === 'dense');
  }, [tweaks.density]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Role">
        <TweakRadio
          options={[{ value: 'manager', label: 'Manager' }, { value: 'cleaner', label: 'Cleaner mobile' }]}
          value={role}
          onChange={setRole}
        />
      </TweakSection>
      <TweakSection title="Layout">
        <TweakRadio
          options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'dense', label: 'Dense' }]}
          value={tweaks.density}
          onChange={(v) => setTweaks(t => ({ ...t, density: v }))}
        />
        <TweakToggle
          label="Collapse sidebar"
          value={tweaks.sidebarCollapsed}
          onChange={(v) => setTweaks(t => ({ ...t, sidebarCollapsed: v }))}
        />
      </TweakSection>
      <TweakSection title="WhatsApp parser">
        <TweakSlider
          label="AI confidence threshold"
          min={0.5} max={1} step={0.01}
          value={tweaks.aiConfidence}
          format={v => Math.round(v * 100) + '%'}
          onChange={(v) => setTweaks(t => ({ ...t, aiConfidence: v }))}
        />
        <TweakToggle
          label="Auto-reply to guest"
          value={tweaks.autoReply}
          onChange={(v) => setTweaks(t => ({ ...t, autoReply: v }))}
        />
        <TweakToggle
          label="Auto-create (skip confirm)"
          value={tweaks.autoCreate}
          onChange={(v) => setTweaks(t => ({ ...t, autoCreate: v }))}
        />
      </TweakSection>
      <TweakSection title="Demo flows">
        <TweakButton onClick={() => goto('onboarding')}>Run setup wizard</TweakButton>
      </TweakSection>
    </TweaksPanel>
  );
};

Object.assign(window, { ProtoTweaks });
