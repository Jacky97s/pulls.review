<script setup lang="ts">
import type { GitlabHostAuth } from '../../state/settings'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import ActionIconButton from '@antfu/design/components/Action/ActionIconButton.vue'
import FormField from '@antfu/design/components/Form/FormField.vue'
import FormTextInput from '@antfu/design/components/Form/FormTextInput.vue'
import { GITLAB_CLOUD_HOST } from '@pulls.review/core/gitlab'
import { computed, ref } from 'vue'
import { gitlabClientId, gitlabRedirectUri, startGitlabSignIn } from '../../state/gitlab-auth'
import { settings } from '../../state/settings'

const props = defineProps<{
  /** Fixes the form to one instance, e.g. the host a failed load came from. */
  host?: string
}>()

const emit = defineEmits<{
  saved: []
}>()

const hostDraft = ref(props.host ?? GITLAB_CLOUD_HOST)
const tokenDraft = ref('')
const clientIdDraft = ref('')
const signInError = ref<string>()

/** Accepts a pasted instance URL as well as a bare host. */
function normalizeHost(text: string): string {
  return text.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
}

const draftHost = computed(() => normalizeHost(hostDraft.value))
const hosts = computed(() => Object.entries(settings.value.gitlab).filter(([host]) => !props.host || host === props.host))
const canSignIn = computed(() => !!draftHost.value && !!gitlabClientId(draftHost.value))

function statusOf(auth: GitlabHostAuth): string {
  if (!auth.token)
    return 'settings.gitlab.applicationSaved'
  return auth.refreshToken ? 'settings.gitlab.signedIn' : 'settings.gitlab.tokenSaved'
}

function updateHost(host: string, patch: Partial<GitlabHostAuth>) {
  const current = settings.value.gitlab[host] ?? { token: '' }
  settings.value = { ...settings.value, gitlab: { ...settings.value.gitlab, [host]: { ...current, ...patch } } }
}

function save() {
  if (!draftHost.value || !tokenDraft.value)
    return
  // A pasted token replaces any OAuth session for this host.
  updateHost(draftHost.value, { token: tokenDraft.value.trim(), refreshToken: undefined, expiresAt: undefined })
  tokenDraft.value = ''
  emit('saved')
}

function saveClientId() {
  if (!draftHost.value || !clientIdDraft.value)
    return
  updateHost(draftHost.value, { clientId: clientIdDraft.value.trim() })
  clientIdDraft.value = ''
}

async function signIn(host: string) {
  signInError.value = undefined
  try {
    await startGitlabSignIn(host, location.pathname + location.search)
  }
  catch (err) {
    signInError.value = (err as Error).message
  }
}

function remove(host: string) {
  const { [host]: _, ...rest } = settings.value.gitlab
  settings.value = { ...settings.value, gitlab: rest }
}

function tokenPageUrl(host: string): string {
  return `https://${host || GITLAB_CLOUD_HOST}/-/user_settings/personal_access_tokens?name=pulls.review&scopes=read_api`
}

function applicationPageUrl(host: string): string {
  return `https://${host || GITLAB_CLOUD_HOST}/-/user_settings/applications`
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="[saved, auth] in hosts" :key="saved" class="flex items-center gap-2 border border-base rounded bg-raised px-3 py-2">
      <div class="i-ph:gitlab-logo-duotone text-lg" />
      <span class="flex-1 truncate text-sm font-mono">{{ saved }}</span>
      <span class="text-xs color-faint">{{ $t(statusOf(auth)) }}</span>
      <ActionButton v-if="!auth.token && gitlabClientId(saved)" size="sm" variant="primary" @click="signIn(saved)">
        {{ $t('settings.gitlab.signIn') }}
      </ActionButton>
      <ActionIconButton
        icon="i-ph:trash-duotone"
        :label="$t('common.remove')"
        :tooltip="$t('common.remove')"
        class="text-sm"
        @click="remove(saved)"
      />
    </div>

    <FormField :error="signInError">
      <template #label>
        <div class="flex items-center gap-1 pb1">
          <div class="i-ph:gitlab-logo-duotone text-lg" />
          {{ host ? $t('settings.gitlab.labelFor', { host }) : $t('settings.gitlab.label') }}
        </div>
      </template>
      <div class="flex flex-col gap-2">
        <FormTextInput
          v-if="!host"
          v-model="hostDraft"
          icon="i-ph:globe-duotone"
          placeholder="gitlab.com"
        />
        <ActionButton v-if="canSignIn" variant="primary" icon="i-ph:sign-in-duotone" class="self-start" @click="signIn(draftHost)">
          {{ $t('settings.gitlab.signInTo', { host: draftHost }) }}
        </ActionButton>
        <form class="flex flex-wrap items-center gap-2" @submit.prevent="save">
          <FormTextInput
            v-model="tokenDraft"
            type="password"
            icon="i-ph-key-duotone"
            placeholder="glpat-…"
            class="min-w-40 flex-1"
          />
          <ActionButton type="submit" :disabled="!tokenDraft || !draftHost">
            {{ $t('common.save') }}
          </ActionButton>
        </form>
      </div>
      <template #description>
        {{ $t('settings.gitlab.hint') }}<br>
        {{ $t('settings.token.storedLocally') }}
        <br><a
          :href="tokenPageUrl(draftHost)"
          target="_blank"
          rel="noopener"
          class="text-primary hover:underline"
        >{{ $t('settings.gitlab.generate') }}</a>
      </template>
    </FormField>

    <FormField v-if="!canSignIn" :label="$t('settings.gitlab.application')">
      <form class="flex flex-wrap items-center gap-2" @submit.prevent="saveClientId">
        <FormTextInput
          v-model="clientIdDraft"
          icon="i-ph:app-window-duotone"
          :placeholder="$t('settings.gitlab.applicationId')"
          class="min-w-40 flex-1"
        />
        <ActionButton type="submit" :disabled="!clientIdDraft || !draftHost">
          {{ $t('common.save') }}
        </ActionButton>
      </form>
      <template #description>
        {{ $t('settings.gitlab.applicationHint', { redirectUri: gitlabRedirectUri() }) }}
        <br><a
          :href="applicationPageUrl(draftHost)"
          target="_blank"
          rel="noopener"
          class="text-primary hover:underline"
        >{{ $t('settings.gitlab.registerApplication') }}</a>
      </template>
    </FormField>
  </div>
</template>
