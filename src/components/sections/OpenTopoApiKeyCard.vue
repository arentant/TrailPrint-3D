<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useConfigStore } from "@/stores/config";
import InfoTooltip from "@/components/ui/InfoTooltip.vue";

const { config } = storeToRefs(useConfigStore());

const apiKeyConfigured = computed(
  () => config.value.terrain.openTopographyApiKey.trim().length > 0,
);

const apiKeyTooltip =
  "Elevation data is provided by OpenTopography.\n" +
  "Register at portal.opentopography.org to request an API key.\n" +
  (window.trailPrint.runtime === "browser"
    ? "Your key is saved in this browser and sent through this site to OpenTopography when requesting elevation data."
    : "Your key is stored on this device and sent to OpenTopography to request elevation data.");
</script>

<template>
  <section
    class="api-key-card"
    :class="apiKeyConfigured ? 'api-key-card--ready' : 'api-key-card--missing'"
    aria-labelledby="opentopo-api-key-title"
  >
    <div class="api-key-card__head">
      <span v-if="!apiKeyConfigured" class="api-key-card__badge">Setup required</span>
      <div class="api-key-card__title-row">
        <h2 id="opentopo-api-key-title" class="api-key-card__title">
          OpenTopography API Key
        </h2>
        <InfoTooltip aria-label="About the API key" :content="apiKeyTooltip" />
      </div>
      <p v-if="!apiKeyConfigured" class="api-key-card__desc">
        Enter your API key to download elevation data. It is saved on this device.
      </p>
    </div>

    <input
      id="opentopo-api-key"
      v-model="config.terrain.openTopographyApiKey"
      type="password"
      class="api-key-card__input"
      placeholder="Paste your API key"
      autocomplete="off"
      spellcheck="false"
    />

    <p v-if="!apiKeyConfigured" class="api-key-card__footer api-key-card__footer--warn">
      An API key is required to generate terrain.
      <a
        class="api-key-card__link"
        href="https://portal.opentopography.org/requestService?service=api"
        target="_blank"
        rel="noopener noreferrer"
        >Get a free API key →</a
      >
    </p>
  </section>
</template>

<style scoped>
.api-key-card {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid transparent;
  background: var(--tp-bg-panel);
  box-shadow: var(--tp-shadow-panel);
}

.api-key-card--missing {
  border-color: rgba(255, 149, 0, 0.45);
  background: linear-gradient(
    135deg,
    rgba(255, 149, 0, 0.08) 0%,
    var(--tp-bg-panel) 55%
  );
}

.api-key-card--ready {
  border-color: rgba(52, 199, 89, 0.35);
  background: linear-gradient(
    135deg,
    rgba(52, 199, 89, 0.06) 0%,
    var(--tp-bg-panel) 55%
  );
}

.api-key-card__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.api-key-card--ready .api-key-card__head {
  margin-bottom: 6px;
}

.api-key-card__badge {
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #c93400;
  background: rgba(255, 149, 0, 0.16);
}

.api-key-card--ready .api-key-card__badge {
  color: #1a7f37;
  background: rgba(52, 199, 89, 0.16);
}

.api-key-card__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.api-key-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--tp-text-primary);
}

.api-key-card__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--tp-text-secondary);
}

.api-key-card__input {
  width: 100%;
  padding: 8px 10px;
  border: 1.5px solid var(--tp-border-strong);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  background: #fff;
  color: var(--tp-text-primary);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.api-key-card--missing .api-key-card__input {
  border-color: rgba(255, 149, 0, 0.5);
}

.api-key-card--missing .api-key-card__input:focus {
  outline: none;
  border-color: #ff9500;
  box-shadow: 0 0 0 3px rgba(255, 149, 0, 0.18);
}

.api-key-card--ready .api-key-card__input:focus {
  outline: none;
  border-color: var(--tp-text-accent);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
}

.api-key-card__footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.4;
}

.api-key-card__footer--warn {
  color: #b45309;
  font-weight: 500;
}

.api-key-card__link {
  font-weight: 600;
  color: var(--tp-text-accent);
  text-decoration: none;
}

.api-key-card__link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
