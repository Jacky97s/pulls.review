<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppContext } from '../../app-context'
import PullsPage from '../../components/pulls/PullsPage.vue'
import { useDocumentTitle } from '../../composables/useDocumentTitle'
import { createPullRequestListStore } from '../../stores/pull-request-list-store'

const route = useRoute()
const host = route.params.host as string
const project = route.params.project as string

const store = createPullRequestListStore({ host, project }, useAppContext())

useDocumentTitle(() => project)

onMounted(() => store.load())
</script>

<template>
  <main>
    <PullsPage :store="store" />
  </main>
</template>
