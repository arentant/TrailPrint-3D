<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue'
import GuideIllustration from './GuideIllustration.vue'
import type { GuideVisual } from './setting-guides'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  ariaLabel?: string
  content: string
  title?: string
  tip?: string
  visual?: GuideVisual
}>()

const tooltipId = `info-tooltip-${useId()}`
const GAP = 10
const MARGIN = 12
const triggerRef = useTemplateRef<HTMLButtonElement>('trigger')
const popupRef = useTemplateRef<HTMLDivElement>('popup')
const visible = ref(false)
const pinned = ref(false)
const hovered = ref(false)
const focused = ref(false)
const positioned = ref(false)
const coords = ref({ top: 0, left: 0 })
const popupWidth = ref(320)
const maxHeight = ref(460)
const placement = ref<'above' | 'below'>('below')
let hideTimer: ReturnType<typeof setTimeout> | undefined

const popupStyle = computed(() => ({
  top: `${coords.value.top}px`,
  left: `${coords.value.left}px`,
  width: `${popupWidth.value}px`,
  maxHeight: `${maxHeight.value}px`,
  visibility: positioned.value ? 'visible' as const : 'hidden' as const,
}))

function cancelHide(): void {
  clearTimeout(hideTimer)
  hideTimer = undefined
}

function close(): void {
  cancelHide()
  visible.value = false
  pinned.value = false
  positioned.value = false
  unbindListeners()
}

async function updatePosition(): Promise<void> {
  if (!visible.value || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  if (rect.bottom < 0 || rect.top > window.innerHeight || !triggerRef.value.getClientRects().length) {
    close()
    return
  }
  popupWidth.value = Math.min(320, Math.max(0, window.innerWidth - MARGIN * 2))
  const below = Math.max(0, window.innerHeight - rect.bottom - GAP - MARGIN)
  const above = Math.max(0, rect.top - GAP - MARGIN)
  const desiredHeight = popupRef.value?.scrollHeight ?? 360
  placement.value = below >= desiredHeight || below >= above ? 'below' : 'above'
  maxHeight.value = Math.min(460, placement.value === 'below' ? below : above)
  await nextTick()
  if (!visible.value) return
  const height = popupRef.value?.offsetHeight ?? maxHeight.value
  coords.value = {
    left: Math.max(MARGIN, Math.min(rect.left + rect.width / 2 - popupWidth.value / 2, window.innerWidth - popupWidth.value - MARGIN)),
    top: placement.value === 'below' ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - height),
  }
  positioned.value = true
}

function onScrollOrResize(): void { void updatePosition() }
function onOutsidePointer(event: PointerEvent): void {
  if (event.target instanceof Node && (triggerRef.value?.contains(event.target) || popupRef.value?.contains(event.target))) return
  close()
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close()
}
function onAnotherTooltip(event: Event): void {
  if ((event as CustomEvent<string>).detail !== tooltipId) close()
}
function bindListeners(): void {
  window.addEventListener('resize', onScrollOrResize)
  window.addEventListener('scroll', onScrollOrResize, true)
  document.addEventListener('pointerdown', onOutsidePointer, true)
  document.addEventListener('keydown', onKeydown, true)
}
function unbindListeners(): void {
  window.removeEventListener('resize', onScrollOrResize)
  window.removeEventListener('scroll', onScrollOrResize, true)
  document.removeEventListener('pointerdown', onOutsidePointer, true)
  document.removeEventListener('keydown', onKeydown, true)
}
async function show(): Promise<void> {
  cancelHide()
  if (!visible.value) {
    window.dispatchEvent(new CustomEvent('trailprint:tooltip-open', { detail: tooltipId }))
    visible.value = true
    bindListeners()
  }
  await nextTick()
  await updatePosition()
}
function scheduleHide(): void {
  cancelHide()
  if (pinned.value || hovered.value || focused.value) return
  hideTimer = setTimeout(close, 180)
}
function onEnter(): void { hovered.value = true; void show() }
function onLeave(): void { hovered.value = false; scheduleHide() }
function onFocus(): void { focused.value = true; void show() }
function onBlur(): void { focused.value = false; scheduleHide() }
function onClick(): void {
  if (pinned.value) close()
  else { pinned.value = true; void show() }
}

onMounted(() => window.addEventListener('trailprint:tooltip-open', onAnotherTooltip))
onBeforeUnmount(() => {
  cancelHide()
  unbindListeners()
  window.removeEventListener('trailprint:tooltip-open', onAnotherTooltip)
})
</script>

<template>
  <span class="info-tip" v-bind="$attrs">
    <button
      ref="trigger"
      type="button"
      class="info-tip__btn"
      :class="{ 'info-tip__btn--open': visible }"
      :aria-label="ariaLabel ?? 'More information'"
      :aria-describedby="visible ? tooltipId : undefined"
      :aria-expanded="visible"
      :aria-controls="visible ? tooltipId : undefined"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
      @focus="onFocus"
      @blur="onBlur"
      @click.stop.prevent="onClick"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.25" />
        <circle cx="8" cy="5" r="0.9" fill="currentColor" />
        <path d="M8 7.25v3.9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
      </svg>
    </button>
  </span>
  <Teleport to="body">
    <div
      v-if="visible"
      :id="tooltipId"
      ref="popup"
      class="info-tip__popup"
      :class="`info-tip__popup--${placement}`"
      :style="popupStyle"
      role="tooltip"
      @mouseenter="hovered = true; cancelHide()"
      @mouseleave="onLeave"
    >
      <div v-if="title" class="info-tip__head">
        <span class="info-tip__eyebrow">Setting guide</span>
        <strong class="info-tip__title">{{ title }}</strong>
      </div>
      <GuideIllustration v-if="visual" :visual="visual" />
      <p class="info-tip__content">{{ props.content }}</p>
      <p v-if="tip" class="info-tip__advice"><span>Tip</span> {{ tip }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.info-tip { display: inline-flex; vertical-align: middle; flex-shrink: 0; }
.info-tip__btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%; background: transparent; color: #72777f; cursor: help; }
.info-tip__btn:hover, .info-tip__btn--open { color: var(--tp-text-accent); background: #007aff12; }
.info-tip__btn:focus-visible { outline: 2px solid var(--tp-text-accent); outline-offset: 2px; }
.info-tip__btn svg { display: block; }
@media (pointer: coarse) { .info-tip__btn { width: 32px; height: 32px; } }
</style>

<style>
/* The guide is teleported so sidebar clipping and modal overflow cannot hide it. */
.info-tip__popup { position: fixed; z-index: 20000; box-sizing: border-box; padding: 16px; border: 1px solid #35484e; border-radius: 14px; background: #172326; color: #f3f7f7; font-family: var(--tp-font); font-size: 12px; line-height: 1.6; text-align: left; overflow: auto; overscroll-behavior: contain; box-shadow: 0 12px 40px #10202438, 0 2px 8px #10202420; pointer-events: auto; }
.info-tip__head { display: flex; flex-direction: column; gap: 3px; margin-bottom: 12px; }
.info-tip__eyebrow { font-size: 9px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #8cddd0; }
.info-tip__title { font-size: 15px; font-weight: 600; line-height: 1.4; }
.info-tip__content { margin: 12px 0 0; white-space: pre-line; color: #e0eaec; }
.info-tip__popup > .info-tip__content:first-child { margin-top: 0; }
.info-tip__advice { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid #35484e; color: #b8ced3; font-size: 11px; line-height: 1.55; }
.info-tip__advice > span { margin-right: 5px; font-weight: 600; color: #efc079; }
</style>
