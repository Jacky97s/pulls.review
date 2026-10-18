<script setup lang="ts">
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import FeedbackEmptyState from '@antfu/design/components/Feedback/FeedbackEmptyState.vue'
import FeedbackLoading from '@antfu/design/components/Feedback/FeedbackLoading.vue'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { completeGitlabSignIn } from '../../state/gitlab-auth'

const route = useRoute()
const router = useRouter()
const error = ref<string>()

const param = (name: string) => typeof route.query[name] === 'string' ? route.query[name] : undefined

onMounted(async () => {
  try {
    const next = await completeGitlabSignIn({ code: param('code'), state: param('state'), error: param('error'), error_description: param('error_description') })
    // Replaced, so "back" never lands on a spent callback URL.
    await router.replace(next)
  }
  catch (err) {
    error.value = (err as Error).message
  }
})
</script>

<template>
  <main class="mxa max-w-200 px-4 py-12">
    <FeedbackEmptyState v-if="error" icon="i-ph:warning-duotone" :title="$t('settings.gitlab.signInFailed')">
      <template #hint>
        {{ error }}
      </template>
      <template #actions>
        <ActionButton variant="primary" to="/">
          {{ $t('settings.gitlab.backHome') }}
        </ActionButton>
      </template>
    </FeedbackEmptyState>
    <FeedbackLoading v-else :text="$t('settings.gitlab.signingIn')" />
  </main>
</template>
