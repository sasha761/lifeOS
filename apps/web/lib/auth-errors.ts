import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SIGNUP_NOT_ALLOWED } from "@lifeos/contracts";

/** Shape of errors returned by the Better Auth client; network failures arrive as `null` data and a thrown error. */
export type AuthClientError = { status?: number; code?: string } | null | undefined;

const TOO_MANY = "Слишком много попыток. Подождите минуту и попробуйте снова.";
const UNAVAILABLE = "Сервис временно недоступен. Попробуйте ещё раз позже.";

export const fieldMessages = {
  name: "Введите имя (до 100 символов).",
  email: "Введите корректный email.",
  currentPassword: "Введите пароль.",
  newPassword: `Пароль должен содержать от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.`,
  confirmPassword: "Пароли не совпадают.",
} as const;

export function signInErrorMessage(error: AuthClientError): string {
  if (error?.status === 401 || error?.code === "INVALID_EMAIL_OR_PASSWORD") return "Неверный email или пароль.";
  if (error?.status === 429) return TOO_MANY;
  return UNAVAILABLE;
}

export function signUpErrorMessage(error: AuthClientError): string {
  if (error?.code === SIGNUP_NOT_ALLOWED || error?.status === 403) {
    return "Регистрация закрыта: этот email не входит в список приглашённых.";
  }
  if (error?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" || error?.code === "USER_ALREADY_EXISTS") {
    return "Аккаунт с таким email уже существует. Войдите или восстановите пароль.";
  }
  if (error?.code === "PASSWORD_TOO_SHORT" || error?.code === "PASSWORD_TOO_LONG") return fieldMessages.newPassword;
  if (error?.status === 400) return "Проверьте введённые данные.";
  if (error?.status === 429) return TOO_MANY;
  return UNAVAILABLE;
}

export function passwordResetRequestErrorMessage(error: AuthClientError): string {
  if (error?.status === 429) return TOO_MANY;
  // Includes delivery failures: the user is never told an email was sent when it was not.
  return "Не удалось отправить письмо. Попробуйте ещё раз позже.";
}

export function passwordResetErrorMessage(error: AuthClientError): string {
  if (error?.code === "PASSWORD_TOO_SHORT" || error?.code === "PASSWORD_TOO_LONG") return fieldMessages.newPassword;
  if (error?.code === "INVALID_TOKEN" || error?.status === 400) return "Ссылка недействительна, устарела или уже использована. Запросите новую.";
  if (error?.status === 429) return TOO_MANY;
  return UNAVAILABLE;
}
