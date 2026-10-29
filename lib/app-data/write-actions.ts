import { executeGroupAction } from "@/lib/app-data/write-group-actions";
import { invalid } from "@/lib/app-data/route-utils";
import { executeBalanceAction } from "@/lib/app-data/write-balance-actions";
import { executeLessonAction } from "@/lib/app-data/write-lesson-actions";
import { executeProfileAction } from "@/lib/app-data/write-profile-actions";
import { executeRequestAction } from "@/lib/app-data/write-request-actions";
import { executeStudentAction } from "@/lib/app-data/write-student-actions";
import type { WriteActionContext } from "@/lib/app-data/write-action-types";

export async function executeAppDataAction(context: WriteActionContext): Promise<Response | void> {
  switch (context.body.action) {
    case "updateOwnAvatarColor":
    case "updateStudentAvatarColor":
    case "updateProfile":
    case "replaceAvailability":
    case "saveTeacherDayNote":
    case "markNotificationsRead":
      return executeProfileAction(context);
    case "createLesson":
    case "updateLesson":
    case "deleteLesson":
    case "stopLessonSeries":
      return executeLessonAction(context);
    case "createStudent":
    case "updateStudent":
    case "updateStudentPrices":
    case "updateStudentGuardian":
    case "convertTrialContact":
    case "archiveStudent":
    case "restoreStudent":
    case "deleteStudent":
    case "createStudentInvite":
      return executeStudentAction(context);
    case "createGroup":
    case "updateGroup":
    case "setGroupMembers":
    case "setGroupSlots":
    case "archiveGroup":
    case "addGroupSession":
    case "cancelGroupSession":
    case "rescheduleGroupSession":
      return executeGroupAction(context);
    case "addPayment":
    case "adjustBalance":
    case "reversePayment":
      return executeBalanceAction(context);
    case "resolveRequest":
    case "submitStudentRequest":
      return executeRequestAction(context);
    default:
      return invalid();
  }
}

