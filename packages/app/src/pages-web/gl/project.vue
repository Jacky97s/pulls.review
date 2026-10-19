<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppContext } from '../../app-context'
import PullsPage from '../../components/pulls/PullsPage.vue'
import { useDocumentTitle } from '../../composables/useDocumentTitle'
import { parseFilters, serializeFilters } from '../../stores/gitlab-list-filters'
import { createPullRequestListStore } from '../../stores/pull-request-list-store'

const route = useRoute()
const router = useRouter()
const host = route.params.host as string
const project = route.params.project as string

const store = createPullRequestListStore({ host, project }, { ...useAppContext(), filters: parseFilters(route.query) })

// The filters live in the URL so a filtered list can be shared or reloaded.
watch(() => store.filters, (filters) => {
  if (filters)
    router.replace({ path: route.path, query: serializeFilters(filters) })
})

useDocumentTitle(() => project)

onMounted(() => store.load())
</script>

<template>
  <main>
    <PullsPage :store="store" />
  </main>
</template>
