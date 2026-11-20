async function mountProviderForm() {
  const electron = window.orbitElectron;
  if (!electron?.getProviderSettings || !electron.saveProvider) return;
  const form = document.getElementById('provider-form');
  const provider = document.getElementById('config-provider');
  const model = document.getElementById('config-model');
  const endpoint = document.getElementById('config-endpoint');
  const liveModel = document.getElementById('config-live');
  const key = document.getElementById('config-key');
  const removeKey = document.getElementById('config-remove-key');
  const useByDefault = document.getElementById('config-default');
  const save = document.getElementById('config-save');
  const message = document.getElementById('config-status');
  let settings = { defaultProvider: '', profiles: {} };

  function paint() {
    const name = provider.value;
    const profile = settings.profiles[name] || {};
    model.value = profile.model || '';
    endpoint.value = profile.baseUrl || '';
    liveModel.value = profile.liveModel || '';
    key.value = '';
    key.placeholder = profile.hasKey ? 'Clave guardada' : 'Clave de API';
    removeKey.checked = false;
    removeKey.disabled = !profile.hasKey;
    useByDefault.checked = settings.defaultProvider === name;
    document.getElementById('config-key-field').hidden = name === 'ollama';
    document.getElementById('config-live-field').hidden = name !== 'gemini';
  }

  provider.addEventListener('change', paint);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      settings = await electron.saveProvider({
        provider: provider.value,
        model: model.value,
        baseUrl: endpoint.value,
        liveModel: liveModel.value,
        apiKey: key.value,
        removeKey: removeKey.checked,
        useByDefault: useByDefault.checked,
      });
      paint();
      message.textContent = settings.applied
        ? 'Guardado y aplicado a los próximos turnos.'
        : 'Guardado. El agente leerá estos ajustes en su próximo arranque.';
    } catch (error) {
      message.textContent = error.message || 'No se pudo guardar la configuración.';
    } finally {
      save.disabled = false;
    }
  });

  form.hidden = false;
  try {
    settings = await electron.getProviderSettings();
    if (settings.defaultProvider) provider.value = settings.defaultProvider;
    paint();
  } catch (error) {
    message.textContent = error.message || 'No se pudo cargar la configuración.';
  }
}

document.addEventListener('DOMContentLoaded', () => { void mountProviderForm(); });
