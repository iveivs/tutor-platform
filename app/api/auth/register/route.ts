export async function POST() {
  return Response.json({ error: "Регистрация преподавателей доступна только по персональному приглашению администратора" }, { status: 403 });
}
