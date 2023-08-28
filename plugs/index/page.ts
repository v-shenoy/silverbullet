import type { IndexEvent, QueryProviderEvent } from "$sb/app_event.ts";
import {
  editor,
  events,
  index,
  markdown,
  mq,
  space,
  system,
} from "$sb/syscalls.ts";

import { applyQuery } from "$sb/lib/query.ts";
import type { MQMessage } from "$sb/types.ts";
import { sleep } from "../../common/async_util.ts";

// Key space:
//   meta: => metaJson

export async function pageQueryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  return applyQuery(query, await space.listPages());
}

export async function reindexCommand() {
  await editor.flashNotification("Performing full page reindex...");
  await reindexSpace();
  await editor.flashNotification("Done with page index!");
}

export async function reindexSpace() {
  console.log("Clearing page index...");
  await index.clearPageIndex();
  // Executed this way to not have to embed the search plug code here
  await system.invokeFunction("search.clearIndex");
  const pages = await space.listPages();

  // Queue all page names to be indexed
  await mq.batchSend("indexQueue", pages.map((page) => page.name));

  // Now let's wait for the processing to finish
  let queueStats = await mq.getQueueStats("indexQueue");
  while (queueStats.queued > 0 || queueStats.processing > 0) {
    sleep(1000);
    queueStats = await mq.getQueueStats("indexQueue");
  }
  // And notify the user
  console.log("Indexing completed!");
}

export async function processIndexQueue(messages: MQMessage[]) {
  for (const message of messages) {
    const name: string = message.body;
    console.log(`Indexing page ${name}`);
    const text = await space.readPage(name);
    // console.log("Going to parse markdown");
    const parsed = await markdown.parseMarkdown(text);
    // console.log("Dispatching ;age:index");
    await events.dispatchEvent("page:index", {
      name,
      tree: parsed,
    });
  }
}

export async function clearPageIndex(page: string) {
  // console.log("Clearing page index for page", page);
  await index.clearPageIndexForPage(page);
}

export async function parseIndexTextRepublish({ name, text }: IndexEvent) {
  console.log("Reindexing", name);
  await events.dispatchEvent("page:index", {
    name,
    tree: await markdown.parseMarkdown(text),
  });
}