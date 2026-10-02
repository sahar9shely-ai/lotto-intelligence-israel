export type TutorialLesson = {
  id: string;
  title: string;
  summary: string;
  duration_seconds: number;
  transcript: string;
};

export type TutorialCatalogue = {
  available: boolean;
  lessons: TutorialLesson[];
};
