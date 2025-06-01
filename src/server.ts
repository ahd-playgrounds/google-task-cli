import { google } from "googleapis";
import { authorize } from "./auth.ts";
import type { OAuthClient } from "./auth.ts";

/**
 * Fetch all task lists
 */
async function getTaskLists(auth: OAuthClient) {
  const tasks = google.tasks({ version: "v1", auth });

  try {
    const res = await tasks.tasklists.list();
    return res.data.items || [];
  } catch (err) {
    console.error("Error fetching task lists:", err);
    return [];
  }
}

/**
 * Fetch tasks from a specific task list
 */
async function getTasks(auth: OAuthClient, taskListId: string) {
  const tasks = google.tasks({ version: "v1", auth });

  try {
    const res = await tasks.tasks.list({
      tasklist: taskListId,
      showCompleted: false, // Only show incomplete tasks
      showDeleted: false,
      showHidden: false,
    });
    return res.data.items || [];
  } catch (err) {
    console.error("Error fetching tasks:", err);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  console.log("🔄 Fetching your Google Tasks...\n");

  const auth = await authorize();
  if (!auth) {
    console.error("❌ Failed to authorize. Please check your credentials.");
    return;
  }

  console.log("✅ Authorization successful!");

  // Get all task lists
  const taskLists = await getTaskLists(auth);
  if (taskLists.length === 0) {
    console.log("No task lists found.");
    return;
  }

  console.log(`📚 Found ${taskLists.length} task list(s)`);

  // Get tasks from all task lists
  const allTasks = await Promise.all(
    taskLists.map((taskList) => getTasks(auth, taskList.id!))
  );

  // Display all tasks
  {
    console.log("\n=== YOUR CURRENT TASKS ===\n");

    let totalTasks = 0;

    taskLists.forEach((taskList, index) => {
      const tasks = allTasks[index];
      if (tasks.length === 0) return;

      console.log(`📋 ${taskList.title} (${tasks.length} tasks)`);
      console.log("─".repeat(40));

      tasks.forEach((task, taskIndex) => {
        const status = task.status === "completed" ? "✅" : "⭕";
        const dueDate = task.due
          ? ` (Due: ${new Date(task.due).toLocaleDateString()})`
          : "";
        const notes = task.notes ? `\n   📝 ${task.notes}` : "";

        console.log(
          `${taskIndex + 1}. ${status} ${task.title}${dueDate}${notes}`
        );
        if (task.links) {
          console.log(" 🔗 Links:");
          for (const link of task.links) {
            console.log(`   ${link.type}: [${link.description}](${link.link})`);
          }
        }
        totalTasks++;
      });
      console.log("");
    });

    if (totalTasks === 0) {
      console.log("🎉 No pending tasks found! You're all caught up!");
    } else {
      console.log(`📊 Total pending tasks: ${totalTasks}`);
    }
  }
}

// Run the script
main().catch(console.error);
