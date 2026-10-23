import { computed } from 'vue'
import { resolveTrailSegments } from '@shared/utils/trail-resolve'
import { useConfigStore } from '@/stores/config'

export function useTrailPoints() {
  const configStore = useConfigStore()
  const effectiveSegments = computed(() => resolveTrailSegments(configStore.config))
  const effectivePoints = computed(() => effectiveSegments.value.flat())
  return { effectivePoints, effectiveSegments }
}
