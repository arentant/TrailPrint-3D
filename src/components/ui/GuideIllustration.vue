<script setup lang="ts">
import { useId } from 'vue'
import type { GuideVisual } from './setting-guides'

defineProps<{ visual: GuideVisual }>()
const arrowId = `guide-arrow-${useId()}`
</script>

<template>
  <figure class="guide-figure">
    <svg viewBox="0 0 300 132" role="img" :aria-label="visual.caption" class="guide-figure__drawing">
      <defs>
        <marker :id="arrowId" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 6 3 0 6" fill="none" stroke="currentColor" stroke-width="1" />
        </marker>
      </defs>
      <path d="M16 100H284" class="baseline" />

      <g v-if="visual.kind === 'shape'">
        <template v-if="visual.focus === 'sides'">
          <path d="M76 20 116 89H36Z" class="object" />
          <path d="M220 19 254 39V77L220 97 186 77V39Z" class="accent" />
        </template>
        <template v-else>
          <circle cx="66" cy="58" r="31" class="accent" />
          <rect x="125" y="32" width="57" height="52" rx="5" class="object" />
          <path d="M239 26 267 42V74L239 90 211 74V42Z" class="object" />
        </template>
      </g>

      <g v-else-if="visual.kind === 'footprint'">
        <template v-if="visual.focus === 'radius'">
          <circle cx="150" cy="57" r="37" class="object" />
          <circle cx="150" cy="57" r="3" class="highlight-fill" />
          <path d="M150 57H187" class="measure" :marker-end="`url(#${arrowId})`" />
          <path d="M113 57H150" class="ghost" />
        </template>
        <template v-else-if="visual.focus === 'side'">
          <path d="M150 16 192 39V79L150 102 108 79V39Z" class="object" />
          <path d="M108 79 150 102" class="highlight" />
          <path d="M101 90 143 113" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
        <template v-else-if="visual.focus === 'corner'">
          <path d="M35 87V27H113" class="object-line" />
          <path d="M186 87V53Q186 27 212 27H264" class="accent-line" />
          <path d="M186 27H214M186 27V55" class="ghost" />
          <path d="M211 52 190 31" class="measure" :marker-end="`url(#${arrowId})`" />
        </template>
        <template v-else>
          <rect x="76" y="28" width="148" height="60" rx="5" class="object" />
          <path v-if="visual.focus === 'length'" d="M80 17H220" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path v-else d="M238 32V84" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path d="M103 70 133 46 158 61 192 42" class="route" />
        </template>
      </g>

      <g v-else-if="visual.kind === 'elevation'">
        <path v-if="visual.focus === 'city'" d="M25 82H127V96H25Z" class="object" />
        <path v-else d="M25 91 49 76 70 82 91 65 117 85 127 91Z" class="object" />
        <path d="M173 91 197 54 218 71 239 28 265 78 275 91Z" class="accent" />
        <path d="M151 79V37" class="measure" :marker-end="`url(#${arrowId})`" />
        <g v-if="visual.focus === 'city'">
          <path d="M57 80V57H69V82M212 64V41H224V56" class="object-line" />
        </g>
      </g>

      <g v-else-if="visual.kind === 'quality'">
        <path d="M27 30H127V90H27ZM27 60H127M77 30V90M27 30 77 60 127 30M27 90 77 60 127 90" class="object-line" />
        <path d="M173 30H273V90H173ZM173 50H273M173 70H273M198 30V90M223 30V90M248 30V90M173 30 248 90M198 30 273 90M173 50 223 90M223 30 273 70M173 70 198 90M248 30 273 50" class="accent-line" />
      </g>

      <g v-else-if="visual.kind === 'smooth'">
        <path d="M24 82 37 59 47 65 57 35 68 52 78 42 87 69 96 54 108 78 127 67" class="object-line" />
        <path d="M174 82C186 67 191 44 206 45S228 66 241 70 258 73 277 67" class="accent-line" />
        <g v-if="visual.focus === 'route'">
          <circle v-for="(point, i) in [[24,82],[47,65],[57,35],[78,42],[96,54],[127,67]]" :key="i" :cx="point[0]" :cy="point[1]" r="3" class="highlight-fill" />
        </g>
      </g>

      <g v-else-if="visual.kind === 'base'">
        <path d="M40 73 74 47 110 59 157 23 203 61 260 73Z" class="object" />
        <rect x="40" y="73" width="220" height="22" class="accent" />
        <path d="M275 76V92" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        <path d="M113 84H171" class="leader" />
      </g>

      <g v-else-if="visual.kind === 'trail'">
        <path d="M38 57H125V91H175V57H261V99H38Z" class="object" />
        <rect x="132" y="35" width="36" height="55" rx="2" class="accent" />
        <path d="M27 57H274" class="ghost" />
        <path v-if="visual.focus === 'width'" d="M135 22H165" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        <path v-else-if="visual.focus === 'depth'" d="M188 61V87" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        <path v-else d="M188 38V54" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
      </g>

      <g v-else-if="visual.kind === 'fit'">
        <rect x="48" y="23" width="204" height="72" rx="12" class="object" />
        <rect x="70" y="39" width="160" height="40" rx="6" class="accent" />
        <path d="M53 59H66M234 59H248" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        <path d="M70 85H230" class="ghost" />
      </g>

      <g v-else-if="visual.kind === 'tray'">
        <path d="M42 36H76V68H224V36H258V97H42Z" class="object" />
        <path d="M86 58 111 37 139 49 171 25 214 58V64H86Z" class="ghost" />
        <path v-if="visual.focus === 'thickness'" d="M276 39V94" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        <template v-else-if="visual.focus === 'depth'">
          <path d="M76 36H224" class="ghost" />
          <path d="M150 39V65" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
        <path v-else d="M45 22H73" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
      </g>

      <g v-else-if="visual.kind === 'pocket'">
        <template v-if="['enabled', 'inset', 'length', 'width'].includes(visual.focus)">
          <rect x="60" y="20" width="180" height="78" rx="13" class="object" />
          <rect x="77" y="35" width="146" height="48" rx="8" class="ghost" />
          <path d="M95 65 123 47 156 65 193 51" class="route" />
          <rect x="85" y="58" width="24" height="12" rx="2" class="accent" />
          <rect x="184" y="44" width="24" height="12" rx="2" class="accent" />
          <path v-if="visual.focus === 'inset'" d="M63 45H74" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path v-else-if="visual.focus === 'length'" d="M87 79H107" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path v-else-if="visual.focus === 'width'" d="M117 60V68" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
        <template v-else>
          <path d="M38 49H67V67H122V83H152V67H233V49H262V98H38Z" class="object" />
          <path d="M67 35H233V43H67Z" :class="visual.focus === 'cover' ? 'accent' : 'ghost'" />
          <rect x="175" y="56" width="33" height="8" rx="2" class="accent" />
          <rect x="128" y="71" width="18" height="8" rx="2" class="accent" />
          <path v-if="visual.focus === 'extraDepth'" d="M111 69V81" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path v-else-if="visual.focus === 'cover'" d="M246 35V43" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path v-else d="M88 51V65" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
      </g>

      <g v-else-if="visual.kind === 'magnet'">
        <template v-if="visual.focus === 'shape'">
          <circle cx="53" cy="56" r="25" class="object" />
          <rect x="117" y="37" width="60" height="38" rx="1" class="object" />
          <path d="M247 25 274 40V72L247 87 220 72V40Z" class="object" />
        </template>
        <template v-else-if="['length', 'width'].includes(visual.focus)">
          <rect x="73" y="28" width="154" height="60" rx="2" class="object" />
          <rect x="81" y="36" width="138" height="44" rx="1" class="accent" />
          <path v-if="visual.focus === 'length'" d="M84 60H216" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path v-else d="M150 39V77" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
        <template v-else-if="visual.focus === 'acrossFlats'">
          <path d="M150 15 194 39V83L150 107 106 83V39Z" class="object" />
          <path d="M109 61H191" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
        <template v-else-if="visual.focus === 'layout'">
          <circle cx="76" cy="58" r="38" class="object" />
          <circle cx="222" cy="58" r="38" class="object" />
          <circle v-for="(point, i) in [[76,32],[76,84],[50,58],[102,58],[222,30],[246,44],[246,72],[222,86],[198,72],[198,44]]" :key="i" :cx="point[0]" :cy="point[1]" r="5" class="accent" />
        </template>
        <template v-else-if="visual.focus === 'depth'">
          <path d="M45 28H255V91H177V56H123V91H45Z" class="object" />
          <rect x="129" y="61" width="42" height="25" rx="2" class="accent" />
          <path d="M192 59V88" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
        <template v-else>
          <circle cx="150" cy="61" r="44" class="object" />
          <circle cx="150" cy="61" r="31" class="accent" />
          <path v-if="visual.focus === 'diameter'" d="M122 61H178" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path v-else d="M184 61H192" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
      </g>

      <g v-else-if="visual.kind === 'mask'">
        <template v-if="['enabled', 'overlap'].includes(visual.focus)">
          <rect x="29" y="26" width="98" height="64" rx="8" class="object" />
          <path d="M59 27H97V89H59Z" class="warm" />
          <path d="M176 26H274V90H176ZM208 38V78H240V38Z" fill-rule="evenodd" class="accent" />
          <path d="M208 38H240V78H208Z" class="ghost" />
          <text x="224" y="61" text-anchor="middle">Open</text>
          <path v-if="visual.focus === 'overlap'" d="M198 20H208" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
        <template v-else-if="visual.focus === 'view'">
          <path d="M25 92 61 61 85 72 126 92Z" class="object" />
          <path d="M25 81 61 50 85 61 126 81V88L85 68 61 57 25 88Z" class="accent" />
          <path d="M174 92 210 61 234 72 275 92Z" class="object" />
          <path d="M174 55 210 24 234 35 275 55V62L234 42 210 31 174 62Z" class="accent" />
          <path d="M258 68V85" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
        <template v-else>
          <path d="M38 91 80 67 115 78 159 46 216 76 262 91Z" class="object" />
          <path d="M37 67 80 43 115 54 159 22 216 52 263 67 262 76 216 61 159 31 115 63 80 52 38 76Z" class="accent" />
          <path v-if="visual.focus === 'thickness'" d="M277 67V76" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
          <path v-else d="M82 55V65" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
      </g>

      <g v-else-if="visual.kind === 'mold'">
        <path d="M39 80H70L99 57 119 69 151 38 186 72H224V80H261V99H39Z" class="object" />
        <path d="M40 80H70V99H40ZM224 80H261V99H224Z" class="accent" />
        <path d="M63 24H85V15H104V24H196V15H215V24H237V35H63Z" class="accent" />
        <path v-if="visual.focus === 'height'" d="M25 82V96" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        <path v-else-if="visual.focus === 'width'" d="M43 70H67" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        <path v-else-if="visual.focus === 'lidHeight'" d="M251 24V35" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        <path v-else-if="visual.focus === 'lidWidth'" d="M65 46H87" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
      </g>

      <g v-else-if="visual.kind === 'sync'">
        <rect x="34" y="31" width="89" height="55" rx="8" class="object" />
        <rect x="177" y="31" width="89" height="55" rx="8" class="accent" />
        <path d="M132 49H168M168 70H132" class="measure" :marker-end="`url(#${arrowId})`" />
        <path d="M49 49H108M49 65H89M192 49H251M192 65H232" class="object-line" />
      </g>

      <g v-else-if="visual.kind === 'city'">
        <path d="M26 91H129M171 91H276" class="object-line" />
        <g v-if="['buildings', 'height'].includes(visual.focus)">
          <path v-if="visual.focus === 'height'" d="M40 91V65H61V91M71 91V55H93V91M103 91V70H119V91" class="object" />
          <path d="M183 91V45H205V91M215 91V24H237V91M247 91V59H265V91" class="accent" />
          <path v-if="visual.focus === 'height'" d="M275 28V87" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </g>
        <template v-else>
          <path d="M28 65H127M79 33V90" class="ghost" />
          <path d="M175 67H269M222 33V88" class="route" />
          <path v-if="visual.focus === 'relief'" d="M247 78V91" class="measure" :marker-start="`url(#${arrowId})`" :marker-end="`url(#${arrowId})`" />
        </template>
      </g>

      <g v-else-if="visual.kind === 'source'">
        <rect x="34" y="27" width="84" height="61" rx="8" class="object" />
        <template v-if="visual.focus === 'key'">
          <circle cx="62" cy="55" r="9" class="accent-line" />
          <path d="M70 61 92 74M82 68 87 61" class="accent-line" />
        </template>
        <template v-else>
          <circle v-for="(point, i) in [[48,40],[70,40],[93,40],[48,57],[70,57],[93,57],[48,74],[70,74],[93,74]]" :key="i" :cx="point[0]" :cy="point[1]" r="2.5" class="highlight-fill" />
        </template>
        <path d="M134 58H161" class="measure" :marker-end="`url(#${arrowId})`" />
        <path d="M178 88 203 55 221 69 243 35 274 88Z" class="accent" />
      </g>

      <g v-else-if="visual.kind === 'paint'">
        <template v-if="visual.focus === 'brush'">
          <circle cx="76" cy="58" r="14" class="accent" />
          <circle cx="220" cy="58" r="33" class="accent" />
          <path d="M70 58H82M76 52V64M214 58H226M220 52V64" class="object-line" />
        </template>
        <template v-else>
          <path d="M35 85 60 38 100 26 129 63 105 91H43Z" class="accent" />
          <path d="M70 33 100 26 129 63 105 91 80 75Z" class="warm" />
          <rect x="187" y="31" width="28" height="58" rx="4" class="accent" />
          <rect x="232" y="31" width="28" height="58" rx="4" class="warm" />
        </template>
      </g>

      <g v-else-if="visual.kind === 'framing'">
        <rect x="30" y="24" width="97" height="67" rx="6" class="object" />
        <path d="M46 76 68 42 89 64 111 34" class="route" />
        <path d="M139 57H162" class="measure" :marker-end="`url(#${arrowId})`" />
        <rect x="175" y="24" width="97" height="67" rx="6" class="accent" />
        <path v-if="visual.focus === 'grid'" d="M199 24V91M223 24V91M247 24V91M175 46H272M175 68H272" class="ghost" />
        <path v-if="visual.focus === 'preset'" d="M190 42H257M190 58H245M190 74H229" class="object-line" />
        <path v-else d="M191 76 213 42 234 64 256 34" class="route" />
      </g>

      <text x="76" y="124" text-anchor="middle">{{ visual.labels[0] }}</text>
      <text x="224" y="124" text-anchor="middle">{{ visual.labels[1] }}</text>
    </svg>
    <figcaption>{{ visual.caption }}</figcaption>
  </figure>
</template>

<style scoped>
.guide-figure { margin: 0; padding: 10px 10px 11px; border: 1px solid #34484d; border-radius: 9px; background: #1a2a2f; }
.guide-figure__drawing { display: block; width: 100%; height: auto; color: #efc079; }
svg path, svg rect, svg circle { stroke-linejoin: round; stroke-linecap: round; }
text { fill: #c9dbde; font-size: 9px; font-family: var(--tp-font); }
.baseline { stroke: #30454b; stroke-width: 1; }
.object { fill: #31494f; stroke: #9ab4ba; stroke-width: 1.5; }
.accent { fill: #315f5a; stroke: #8cddd0; stroke-width: 1.8; }
.warm { fill: #655338; stroke: #efc079; stroke-width: 1.5; }
.object-line { fill: none; stroke: #9ab4ba; stroke-width: 1.6; }
.accent-line { fill: none; stroke: #8cddd0; stroke-width: 2; }
.ghost { fill: none; stroke: #7a959c; stroke-width: 1.2; stroke-dasharray: 4 4; }
.measure { fill: none; stroke: currentColor; stroke-width: 1.5; }
.highlight { fill: none; stroke: #efc079; stroke-width: 3; }
.highlight-fill { fill: #efc079; }
.route { fill: none; stroke: #8cddd0; stroke-width: 5; }
.leader { fill: none; stroke: #8cddd0; stroke-width: 1; }
figcaption { margin-top: 6px; color: #b8ced3; font-size: 11px; line-height: 1.45; }
</style>
