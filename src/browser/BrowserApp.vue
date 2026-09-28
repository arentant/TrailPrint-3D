<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import TrailPrintLogo from '@/components/ui/TrailPrintLogo.vue'

const Workspace = defineAsyncComponent(() => import('../App.vue'))
const user = ref<{ name?: string; email: string } | null>(null)
const loading = ref(true)
const busy = ref(false)
const unavailable = ref(false)
const callbackError = new URLSearchParams(window.location.search).get('error')
const message = ref(callbackError === 'AccessDenied'
  ? 'This Google account does not have access. Try an approved account or contact the workspace owner.'
  : callbackError ? 'Sign-in could not be completed. Please try again.' : '')
let checking = false
let refreshTimer: ReturnType<typeof setInterval> | undefined

async function checkSession(): Promise<void> {
  if (checking) return
  checking = true
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Sign-in is unavailable right now. Please try again or contact the workspace owner.')
    const session = await response.json()
    const wasSignedIn = user.value !== null
    user.value = session?.user?.email ? session.user : null
    if (user.value || unavailable.value) message.value = ''
    if (wasSignedIn && !user.value) message.value = 'Your session has ended. Sign in again to continue.'
    unavailable.value = false
  } catch (error) {
    user.value = null
    unavailable.value = true
    message.value = error instanceof Error && error.name !== 'TimeoutError'
      ? error.message : 'Could not check your session. Please try again.'
  } finally {
    checking = false
    loading.value = false
  }
}

async function submitAuth(action: 'signin/google' | 'signout'): Promise<void> {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const response = await fetch('/api/auth/csrf', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Sign-in is unavailable right now. Please try again.')
    const { csrfToken } = await response.json()
    if (typeof csrfToken !== 'string' || !csrfToken) throw new Error('Could not start sign-in. Please try again.')
    // Submit a normal form so OAuth redirects navigate the browser, not a fetch request.
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = `/api/auth/${action}`
    for (const [name, value] of Object.entries({ csrfToken, callbackUrl: window.location.origin })) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = value
      form.appendChild(input)
    }
    document.body.appendChild(form)
    form.submit()
    form.remove()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Please try again.'
    busy.value = false
  }
}

function refreshWhenVisible(): void {
  if (document.visibilityState === 'visible') void checkSession()
}

onMounted(() => {
  void checkSession()
  refreshTimer = setInterval(refreshWhenVisible, 60_000)
  window.addEventListener('focus', refreshWhenVisible)
  window.addEventListener('trailprint:auth-required', refreshWhenVisible)
  document.addEventListener('visibilitychange', refreshWhenVisible)
})

onUnmounted(() => {
  clearInterval(refreshTimer)
  window.removeEventListener('focus', refreshWhenVisible)
  window.removeEventListener('trailprint:auth-required', refreshWhenVisible)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
})
</script>

<template>
  <template v-if="user">
    <header class="account-bar" aria-label="Account">
      <p v-if="message" role="alert">{{ message }}</p>
      <span>{{ user.email }}</span>
      <button type="button" :disabled="busy" @click="submitAuth('signout')">{{ busy ? 'Signing out…' : 'Sign out' }}</button>
    </header>
    <Workspace />
  </template>
  <main v-else class="sign-in">
    <section class="sign-in__story" aria-label="TrailPrint 3D Terrain Studio">
      <div class="sign-in__brand"><TrailPrintLogo :size="42" /><span>TrailPrint <small>3D TERRAIN STUDIO</small></span></div>
      <div class="sign-in__intro">
        <p class="sign-in__eyebrow">A trail worth keeping.</p>
        <h1>Your adventures,<br>in three dimensions.</h1>
        <p>Turn the places you’ve explored into terrain you can hold. Import a GPX track, shape your model, and make it yours.</p>
      </div>
      <svg class="sign-in__contours" viewBox="0 0 760 350" fill="none" aria-hidden="true">
        <g stroke="currentColor" stroke-width="1.2">
          <path v-for="i in 12" :key="i" :transform="`translate(${380 * (1 - (0.35 + i * 0.07))}, ${175 * (1 - (0.35 + i * 0.07))}) scale(${0.35 + i * 0.07})`" d="M34 235C24 163 132 192 171 101S287 50 332 67S392 142 462 105S580 17 645 78S657 171 708 223S650 304 550 287S438 302 371 272S248 329 172 282S48 304 34 235Z" />
        </g>
        <path d="M119 254C180 226 165 186 219 171S283 110 335 137S382 230 431 202S505 158 565 121" stroke="#007aff" stroke-width="3" stroke-linecap="round" />
        <circle cx="565" cy="121" r="6" fill="#007aff" />
        <circle cx="119" cy="254" r="4" fill="#007aff" />
      </svg>
      <p class="sign-in__caption">FROM THE TRAIL TO YOUR TABLE.</p>
    </section>
    <section class="sign-in__entry" aria-labelledby="sign-in-title">
      <div class="sign-in__card">
        <span class="sign-in__private">Private workspace</span>
        <h2 id="sign-in-title">Sign in to TrailPrint</h2>
        <p class="sign-in__description">Use your approved Google account to open the studio.</p>
        <p v-if="loading" class="sign-in__loading" role="status">Checking your session…</p>
        <template v-else>
          <p v-if="message" class="sign-in__message" role="alert">{{ message }}</p>
          <button v-if="unavailable" class="sign-in__button" type="button" @click="checkSession">Try again</button>
          <button v-else class="sign-in__button" type="button" :disabled="busy" @click="submitAuth('signin/google')">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
              <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z" />
              <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59C7.19 7.72 9.4 5.96 12 5.96Z" />
            </svg>
            {{ busy ? 'Connecting…' : 'Continue with Google' }}
          </button>
          <p class="sign-in__note">Access is limited to approved accounts.<br>Need access? Contact the workspace owner.</p>
        </template>
      </div>
      <p class="sign-in__privacy">Your GPX files and model generation stay on your device.</p>
    </section>
  </main>
</template>

<style scoped>
.account-bar { display: flex; justify-content: flex-end; align-items: center; gap: 16px; padding: 10px 24px 0; font-size: 12px; color: var(--tp-text-secondary); }
.account-bar p { margin: 0 auto 0 0; color: #ac3535; }
.account-bar button { color: var(--tp-text-primary); padding: 4px 8px; text-decoration: underline; text-underline-offset: 3px; }
.sign-in { display: grid; grid-template-columns: 1.15fr 1fr; flex: 1; min-height: 0; overflow: auto; background: var(--tp-bg-panel); }
.sign-in__story { position: relative; overflow: hidden; display: flex; flex-direction: column; padding: clamp(32px, 5vw, 80px); background: #f0f2f4; }
.sign-in__brand { display: flex; align-items: center; gap: 12px; font-size: 21px; font-weight: 650; }
.sign-in__brand small { display: block; margin-top: 4px; font-size: 9px; letter-spacing: .15em; font-weight: 500; color: #696e76; }
.sign-in__intro { position: relative; z-index: 1; margin: auto 0; padding: 70px 0 135px; max-width: 570px; }
.sign-in__eyebrow { font-size: 13px; color: #007aff; font-weight: 600; }
.sign-in h1 { margin: 18px 0 24px; font-size: clamp(34px, 3.7vw, 58px); line-height: 1.08; letter-spacing: -.055em; font-weight: 600; }
.sign-in__intro > p:last-child { max-width: 390px; color: #656b73; line-height: 1.75; font-size: 15px; }
.sign-in__contours { position: absolute; width: 115%; left: -8%; bottom: -20px; color: #c6ccd3; opacity: .9; }
.sign-in__caption { position: relative; z-index: 1; margin: 0; font-size: 9px; letter-spacing: .18em; color: #656b73; }
.sign-in__entry { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 64px 40px; position: relative; }
.sign-in__card { width: 100%; max-width: 350px; }
.sign-in__private { display: inline-block; padding: 6px 10px; border-radius: 6px; background: #f2f5f8; color: #56616d; font-size: 11px; font-weight: 500; }
.sign-in h2 { margin: 24px 0 12px; font-size: 29px; letter-spacing: -.035em; font-weight: 600; }
.sign-in__description { color: #757a81; font-size: 14px; line-height: 1.7; margin-bottom: 32px; }
.sign-in__button { width: 100%; display: flex; justify-content: center; align-items: center; gap: 12px; min-height: 50px; border: 1px solid #dadce0; border-radius: 10px; background: white; color: #272b31; font-weight: 500; font-size: 14px; transition: background .15s, border-color .15s; }
.sign-in__button:hover { background: #f7f9fc; border-color: #aeb7c3; }
button:focus-visible { outline: 3px solid #007aff; outline-offset: 3px; }
button:disabled { cursor: wait; opacity: .6; }
.sign-in__note { margin: 22px 0 0; font-size: 12px; line-height: 1.8; color: #878c93; text-align: center; }
.sign-in__message { padding: 14px; margin-bottom: 20px; border-radius: 8px; background: #fff2ef; color: #943e2f; font-size: 13px; line-height: 1.6; }
.sign-in__loading { color: #757a81; font-size: 14px; }
.sign-in__privacy { position: absolute; bottom: 30px; left: 24px; right: 24px; text-align: center; font-size: 11px; line-height: 1.7; color: #969ba3; }
@media (max-width: 760px) {
  .sign-in { grid-template-columns: 1fr; }
  .sign-in__story { padding: 28px; min-height: 280px; }
  .sign-in__intro { margin: 35px 0 0; padding: 0; }
  .sign-in h1 { font-size: 36px; }
  .sign-in__intro > p:last-child, .sign-in__caption { display: none; }
  .sign-in__contours { width: 75%; left: 45%; bottom: -60px; opacity: .5; }
  .sign-in__entry { padding: 44px 28px 90px; }
  .account-bar { padding-left: 12px; padding-right: 12px; }
}
</style>
