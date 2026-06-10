import { getWorkspaceApiBaseUrl } from './workspace-api';

export type QuizQuestion = {
  correct_answer?: string | null;
  explanation?: string | null;
  is_correct?: boolean | null;
  options?: string[];
  question?: string | null;
  question_index?: number | string | null;
  type?: string | null;
  user_answer?: string | null;
  [key: string]: unknown;
};

export type SavedQuiz = {
  correct_count?: number | null;
  created_at?: string | null;
  quiz_data?: QuizQuestion[];
  quiz_id: string;
  session_id?: string | null;
  source_title?: string | null;
  total_questions?: number | null;
  type_counts?: Record<string, number>;
  [key: string]: unknown;
};

export type QuizSubmissionResult = {
  correct_count: number;
  quiz_data: QuizQuestion[];
  quiz_id: string;
  score: number;
  total_questions: number;
};

type QuizListResponse = {
  quizzes?: SavedQuiz[];
};

const QUIZ_API_BASE = `${getWorkspaceApiBaseUrl()}/quiz`;

async function parseApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const rawResult = await response.text();
  let result: Record<string, unknown> = {};

  try {
    result = rawResult ? JSON.parse(rawResult) : {};
  } catch {
    result = { error: rawResult };
  }

  if (!response.ok || result.ok === false) {
    const message =
      typeof result.error === 'string'
        ? result.error
        : typeof result.detail === 'string'
          ? result.detail
          : `${fallbackMessage} (${response.status})`;
    throw new Error(message);
  }

  return result as T;
}

function normalizeQuestion(question: QuizQuestion, index: number): QuizQuestion {
  const type = String(question.type ?? '').trim().toUpperCase();
  const options = Array.isArray(question.options)
    ? question.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
    : type === 'OX'
      ? ['O', 'X']
      : [];

  return {
    ...question,
    options,
    question_index: question.question_index ?? index + 1,
    type,
  };
}

export function getQuizQuestions(quiz?: SavedQuiz | null) {
  return Array.isArray(quiz?.quiz_data)
    ? quiz.quiz_data
        .filter((question): question is QuizQuestion => Boolean(question && typeof question === 'object'))
        .map((question, index) => normalizeQuestion(question, index))
    : [];
}

export function getQuizQuestionKey(question: QuizQuestion, index: number) {
  return String(question.question_index ?? index + 1);
}

export async function fetchSessionQuizzes(sessionId: string) {
  const result = await parseApiResponse<QuizListResponse>(
    await fetch(`${QUIZ_API_BASE}/session/${encodeURIComponent(sessionId)}`),
    '퀴즈 목록을 불러오지 못했습니다.',
  );

  return Array.isArray(result.quizzes) ? result.quizzes : [];
}

export async function fetchQuizDetail(quizId: string) {
  return parseApiResponse<SavedQuiz>(
    await fetch(`${QUIZ_API_BASE}/${encodeURIComponent(quizId)}`),
    '퀴즈를 불러오지 못했습니다.',
  );
}

export async function submitQuizAnswers(quizId: string, answers: Record<string, string>) {
  return parseApiResponse<QuizSubmissionResult>(
    await fetch(`${QUIZ_API_BASE}/${encodeURIComponent(quizId)}/submit`, {
      body: JSON.stringify({ answers }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    }),
    '퀴즈 채점에 실패했습니다.',
  );
}
