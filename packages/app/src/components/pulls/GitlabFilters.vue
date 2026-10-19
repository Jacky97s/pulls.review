<script setup lang="ts">
import type { GitlabMergeRequestFilters } from '@pulls.review/core/gitlab'
import type { PullRequestListStore } from '../../stores/pull-request-list-store'
import FormCombobox from '@antfu/design/components/Form/FormCombobox.vue'
import FormSegmentedControl from '@antfu/design/components/Form/FormSegmentedControl.vue'
import FormSelect from '@antfu/design/components/Form/FormSelect.vue'
import FormTextInput from '@antfu/design/components/Form/FormTextInput.vue'
import { GITLAB_MR_DRAFT, GITLAB_MR_MINE, GITLAB_MR_STATES } from '@pulls.review/core/gitlab'
import { watchDebounced } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  store: PullRequestListStore
  filters: GitlabMergeRequestFilters
}>()

const { t } = useI18n()

function update(patch: Partial<GitlabMergeRequestFilters>) {
  props.store.setFilters({ ...props.filters, ...patch })
}

const stateOptions = computed(() => GITLAB_MR_STATES.map(value => ({ value, label: t(`pulls.filters.state.${value}`) })))
const mineOptions = computed(() => ['none', ...GITLAB_MR_MINE].map(value => ({ value, label: t(`pulls.filters.mine.${value}`) })))
const draftOptions = computed(() => GITLAB_MR_DRAFT.map(value => ({ value, label: t(`pulls.filters.draft.${value}`) })))
const labelChoices = computed(() => props.store.labelOptions
  .filter(name => !props.filters.labels.includes(name))
  .map(value => ({ value })))

const targetBranch = ref(props.filters.targetBranch ?? '')
watch(() => props.filters.targetBranch, (value) => {
  targetBranch.value = value ?? ''
})
watchDebounced(targetBranch, (value) => {
  const next = value.trim() || undefined
  if (next !== props.filters.targetBranch)
    update({ targetBranch: next })
}, { debounce: 500 })
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <FormSegmentedControl
      :model-value="filters.state"
      :options="stateOptions"
      :aria-label="$t('pulls.filters.stateLabel')"
      @update:model-value="update({ state: $event as GitlabMergeRequestFilters['state'] })"
    />
    <FormSelect
      :model-value="filters.mine ?? 'none'"
      :options="mineOptions"
      class="min-w-36 h-7!"
      :aria-label="$t('pulls.filters.mineLabel')"
      @update:model-value="update({ mine: $event === 'none' ? undefined : $event as GitlabMergeRequestFilters['mine'] })"
    />
    <FormSelect
      :model-value="filters.draft"
      :options="draftOptions"
      class="min-w-36 h-7!"
      :aria-label="$t('pulls.filters.draftLabel')"
      @update:model-value="update({ draft: $event as GitlabMergeRequestFilters['draft'] })"
    />
    <FormTextInput
      v-model="targetBranch"
      icon="i-ph:git-branch"
      size="sm"
      clearable
      :placeholder="$t('pulls.filters.targetBranch')"
      class="min-w-40"
    />
    <FormCombobox
      model-value=""
      :options="labelChoices"
      :placeholder="$t('pulls.filters.addLabel')"
      class="text-xs h-7! min-w-40!"
      @update:model-value="name => name && update({ labels: [...filters.labels, name] })"
    >
      <template #empty>
        {{ $t('pulls.filters.noLabels') }}
      </template>
    </FormCombobox>
    <button
      v-for="label in filters.labels"
      :key="label"
      type="button"
      class="inline-flex items-center gap-1 border border-base rounded-full bg-raised px-2 py-0.5 text-xs transition hover:bg-hover"
      :title="$t('pulls.filters.removeLabel', { label })"
      :aria-label="$t('pulls.filters.removeLabel', { label })"
      @click="update({ labels: filters.labels.filter(name => name !== label) })"
    >
      {{ label }}
      <span class="i-ph:x op-fade" aria-hidden="true" />
    </button>
  </div>
</template>
