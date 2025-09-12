--
-- PostgreSQL database dump
--

-- Dumped from database version 16.9
-- Dumped by pg_dump version 16.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AssessmentQuestion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AssessmentQuestion" (
    id text NOT NULL,
    "assessmentId" text NOT NULL,
    prompt text NOT NULL,
    type character varying(30) NOT NULL,
    options text[],
    "correctOptionIndex" integer,
    points integer DEFAULT 1 NOT NULL,
    "order" integer DEFAULT 1 NOT NULL,
    "correctOptionIndexes" integer[] DEFAULT ARRAY[]::integer[],
    "correctText" text,
    pairs jsonb,
    "sampleAnswer" text
);


--
-- Name: Course; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Course" (
    id text NOT NULL,
    title text NOT NULL,
    thumbnail text,
    status text DEFAULT 'draft'::text NOT NULL,
    "creatorId" text NOT NULL,
    "managerId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CourseInstructor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CourseInstructor" (
    id text NOT NULL,
    "courseId" text NOT NULL,
    "instructorId" text NOT NULL
);


--
-- Name: Enrollment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Enrollment" (
    id text NOT NULL,
    "courseId" text NOT NULL,
    "studentId" text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: assessment_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_attempts (
    id text NOT NULL,
    "assessmentId" text NOT NULL,
    "studentId" text NOT NULL,
    "startedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "submittedAt" timestamp(3) without time zone,
    status text DEFAULT 'in_progress'::text NOT NULL,
    score integer,
    "maxScore" integer,
    answers jsonb
);


--
-- Name: assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessments (
    id text NOT NULL,
    title text NOT NULL,
    type text DEFAULT 'quiz'::text NOT NULL,
    scope text DEFAULT 'chapter'::text NOT NULL,
    "timeLimitSeconds" integer,
    "maxAttempts" integer DEFAULT 1 NOT NULL,
    "isPublished" boolean DEFAULT true NOT NULL,
    "order" integer,
    "courseId" text,
    "chapterId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: chapter_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chapter_progress (
    id text NOT NULL,
    "isCompleted" boolean DEFAULT false NOT NULL,
    "timeSpent" integer DEFAULT 0 NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "chapterId" text NOT NULL,
    "studentId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: chapters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chapters (
    id text NOT NULL,
    title character varying(200) NOT NULL,
    slug character varying(250) NOT NULL,
    description text,
    content text,
    attachments text[],
    "order" integer NOT NULL,
    "isPreview" boolean DEFAULT false NOT NULL,
    "isPublished" boolean DEFAULT true NOT NULL,
    "courseId" text NOT NULL,
    settings jsonb DEFAULT '{"allowNotes": true, "allowComments": true, "allowDownloads": true}'::jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: course_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_reviews (
    id text NOT NULL,
    rating integer NOT NULL,
    comment text,
    "isPublic" boolean DEFAULT true NOT NULL,
    "courseId" text NOT NULL,
    "studentId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email character varying(100) NOT NULL,
    password text NOT NULL,
    role text DEFAULT 'student'::text NOT NULL,
    "isEmailVerified" boolean DEFAULT false NOT NULL,
    "emailVerificationToken" text,
    "emailVerificationExpires" timestamp(3) without time zone,
    "passwordResetToken" text,
    "passwordResetExpires" timestamp(3) without time zone,
    "lastLogin" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "fullName" character varying(100) NOT NULL,
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Data for Name: AssessmentQuestion; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."AssessmentQuestion" (id, "assessmentId", prompt, type, options, "correctOptionIndex", points, "order", "correctOptionIndexes", "correctText", pairs, "sampleAnswer") FROM stdin;
87b4ecc4-36f5-47cf-bf8f-4be7fbe321ec	f60db8b7-2c0a-452d-b545-f4d9b18cee98	Pick one	MCQ	{A,B}	0	5	1	{}	\N	\N	\N
f1d309eb-04ef-418c-9c30-e0d25f96da6c	1a67a241-7124-43aa-8b39-7d27ac267788	2+2=?	MCQ	{3,4,5}	1	2	1	{}	\N	\N	\N
31fd816b-15b9-4b56-bfb0-72b9249ba1a3	1a67a241-7124-43aa-8b39-7d27ac267788	True is boolean?	TRUE_FALSE	{True,False}	0	1	2	{}	\N	\N	\N
b6ea007c-2b42-40b2-96f7-a47f9a570645	a5981c4a-265b-41dd-beb0-0c6900f5289c	why python is called interpreted language 	single	{"it execute line by line ","it execute at a time ","easy to learn","none of the above "}	0	1	1	{}	\N	\N	\N
\.


--
-- Data for Name: Course; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Course" (id, title, thumbnail, status, "creatorId", "managerId", "createdAt", "updatedAt") FROM stdin;
d451d22e-46be-45ba-a429-be636f985d2b	JavaScript Basics	https://picsum.photos/seed/js/600/300	published	38f69af6-dfa3-4af0-9d88-e45f5be87c21	\N	2025-09-03 16:41:49.964	2025-09-03 16:41:49.964
aae0afd4-2d71-4baf-a66d-4a07d9b59883	Python course	\N	draft	38f69af6-dfa3-4af0-9d88-e45f5be87c21	\N	2025-09-05 11:16:43.097	2025-09-05 11:16:43.097
\.


--
-- Data for Name: CourseInstructor; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."CourseInstructor" (id, "courseId", "instructorId") FROM stdin;
\.


--
-- Data for Name: Enrollment; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Enrollment" (id, "courseId", "studentId", status, progress) FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
316515d3-52eb-434f-b6e2-a2673b51f6d6	0356d9f9388ea7c4aa6b889dcd9aa48d5162d0179a2e26f8725a898ecd43c563	2025-09-01 16:56:09.331753+05:30	20250901112609_lms_migration	\N	\N	2025-09-01 16:56:09.085384+05:30	1
038183b1-5e0d-478f-a95a-40f8e15bdc51	2cc811874ee425a06704665264f50e4507d52efbed036678b8ca48f1e924faa8	2025-09-02 18:34:07.245624+05:30	20250902130407_update_user_model	\N	\N	2025-09-02 18:34:07.234438+05:30	1
2f21c99a-7905-4fdc-a1e6-4e84bde046f6	9a0f442a94a6d563aa2e054fd179999795c8a8ffd1a03b3528658ace7effa744	2025-09-03 19:35:01.496181+05:30	20250903140501_update_models	\N	\N	2025-09-03 19:35:01.224546+05:30	1
c6ae077c-134a-46fa-a259-b0aec0313e05	f5c1d0db91e78828ca94681d1adc40c9f7310b18be0c3b6010667e3ecd5c85d7	2025-09-03 22:29:53.717834+05:30	20250903165953_add_type_to_assessment_question	\N	\N	2025-09-03 22:29:53.714447+05:30	1
a1097438-01d0-4546-a567-6850558eab69	f3a5b0296be675bc6a29491f82f48d421f167f2cd29ac5b26b749221e755d02b	2025-09-03 22:33:47.11125+05:30	20250903170347_add_correct_option_index	\N	\N	2025-09-03 22:33:47.09014+05:30	1
9b587106-2091-4bc3-8b46-da630fcfd2ea	c36d0c3872efa6d61eff08b9694dac51947b89d702050f0cd2c8d6ac07f5f486	2025-09-05 00:54:37.649513+05:30	20250904192437_add_user_permissions	\N	\N	2025-09-05 00:54:37.62878+05:30	1
20d636bc-3e3f-4b43-a4e9-a0ac5f99bf63	c858e7f3b214680979a2ae1159767ef3fb5bfee2469f4a18f7f05f66b688de95	2025-09-05 15:44:48.327044+05:30	20250905101448_fix_assessment_question_string_types	\N	\N	2025-09-05 15:44:48.306367+05:30	1
\.


--
-- Data for Name: assessment_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.assessment_attempts (id, "assessmentId", "studentId", "startedAt", "submittedAt", status, score, "maxScore", answers) FROM stdin;
3d31772a-0f43-4546-b80c-b42f380a9fa3	a5981c4a-265b-41dd-beb0-0c6900f5289c	38f69af6-dfa3-4af0-9d88-e45f5be87c21	2025-09-05 12:37:43.771	2025-09-05 12:37:43.768	submitted	1	1	{"b6ea007c-2b42-40b2-96f7-a47f9a570645": 0}
b4587299-af77-468e-869d-caa0e4b3dad7	a5981c4a-265b-41dd-beb0-0c6900f5289c	38f69af6-dfa3-4af0-9d88-e45f5be87c21	2025-09-05 13:17:03.191	2025-09-05 13:17:03.189	submitted	1	1	{"b6ea007c-2b42-40b2-96f7-a47f9a570645": 0}
\.


--
-- Data for Name: assessments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.assessments (id, title, type, scope, "timeLimitSeconds", "maxAttempts", "isPublished", "order", "courseId", "chapterId", "createdAt", "updatedAt") FROM stdin;
f60db8b7-2c0a-452d-b545-f4d9b18cee98	Final Test	FINAL	chapter	1800	1	t	\N	d451d22e-46be-45ba-a429-be636f985d2b	\N	2025-09-03 17:05:16.118	2025-09-03 17:05:16.118
1a67a241-7124-43aa-8b39-7d27ac267788	Chapter 1 Quiz	QUIZ	chapter	900	1	t	\N	d451d22e-46be-45ba-a429-be636f985d2b	f28dba91-07b8-4b05-829f-00d4312df889	2025-09-03 17:07:24.428	2025-09-03 17:07:24.428
a5981c4a-265b-41dd-beb0-0c6900f5289c	Chapter 1 quiz	quiz	chapter	1800	1	t	1	\N	f755dc48-e906-4011-9d71-e0c522c12e26	2025-09-05 11:16:43.13	2025-09-05 11:16:43.13
\.


--
-- Data for Name: chapter_progress; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.chapter_progress (id, "isCompleted", "timeSpent", "completedAt", "chapterId", "studentId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: chapters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.chapters (id, title, slug, description, content, attachments, "order", "isPreview", "isPublished", "courseId", settings, "createdAt", "updatedAt") FROM stdin;
f28dba91-07b8-4b05-829f-00d4312df889	Intro	intro	\N	\N	\N	1	t	t	d451d22e-46be-45ba-a429-be636f985d2b	{"allowNotes": true, "allowComments": true, "allowDownloads": true}	2025-09-03 16:45:23.063	2025-09-03 16:45:23.063
85491dc0-e9aa-4c98-81c4-6e502fba3ddf	basics of python	1-basics-of-python	nothing 	nothing 	{}	1	f	t	aae0afd4-2d71-4baf-a66d-4a07d9b59883	{"allowNotes": true, "allowComments": true, "allowDownloads": true}	2025-09-05 11:16:43.123	2025-09-05 11:16:43.123
f755dc48-e906-4011-9d71-e0c522c12e26	Chapter 1 quiz	2-chapter-1-quiz	Chapter 1 quiz	\N	{}	2	f	t	aae0afd4-2d71-4baf-a66d-4a07d9b59883	{"allowNotes": true, "allowComments": true, "allowDownloads": true}	2025-09-05 11:16:43.128	2025-09-05 11:16:43.128
\.


--
-- Data for Name: course_reviews; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.course_reviews (id, rating, comment, "isPublic", "courseId", "studentId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password, role, "isEmailVerified", "emailVerificationToken", "emailVerificationExpires", "passwordResetToken", "passwordResetExpires", "lastLogin", "isActive", "createdAt", "updatedAt", "fullName", permissions) FROM stdin;
38f69af6-dfa3-4af0-9d88-e45f5be87c21	sara.super@example.com	$2a$12$xT0NfxcMYmtwbZ212HBMDufyPA3Dl6jZTgCXxT95HSoKC42DkGWCW	SUPER_ADMIN	f	14f785d2556676c4b9e4152398e6ddffeb4ef57f1c2a357223ee005869db1db1	2025-09-04 16:08:20.081	\N	\N	2025-09-03 16:10:17.114	t	2025-09-03 16:08:20.085	2025-09-03 16:10:17.115	Sara Super	{}
\.


--
-- Name: AssessmentQuestion AssessmentQuestion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AssessmentQuestion"
    ADD CONSTRAINT "AssessmentQuestion_pkey" PRIMARY KEY (id);


--
-- Name: CourseInstructor CourseInstructor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CourseInstructor"
    ADD CONSTRAINT "CourseInstructor_pkey" PRIMARY KEY (id);


--
-- Name: Course Course_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Course"
    ADD CONSTRAINT "Course_pkey" PRIMARY KEY (id);


--
-- Name: Enrollment Enrollment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Enrollment"
    ADD CONSTRAINT "Enrollment_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: assessment_attempts assessment_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_attempts
    ADD CONSTRAINT assessment_attempts_pkey PRIMARY KEY (id);


--
-- Name: assessments assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_pkey PRIMARY KEY (id);


--
-- Name: chapter_progress chapter_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chapter_progress
    ADD CONSTRAINT chapter_progress_pkey PRIMARY KEY (id);


--
-- Name: chapters chapters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_pkey PRIMARY KEY (id);


--
-- Name: course_reviews course_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_reviews
    ADD CONSTRAINT course_reviews_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: AssessmentQuestion_assessmentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AssessmentQuestion_assessmentId_idx" ON public."AssessmentQuestion" USING btree ("assessmentId");


--
-- Name: CourseInstructor_courseId_instructorId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CourseInstructor_courseId_instructorId_key" ON public."CourseInstructor" USING btree ("courseId", "instructorId");


--
-- Name: CourseInstructor_instructorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CourseInstructor_instructorId_idx" ON public."CourseInstructor" USING btree ("instructorId");


--
-- Name: Course_creatorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Course_creatorId_idx" ON public."Course" USING btree ("creatorId");


--
-- Name: Course_managerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Course_managerId_idx" ON public."Course" USING btree ("managerId");


--
-- Name: Course_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Course_status_idx" ON public."Course" USING btree (status);


--
-- Name: Enrollment_courseId_studentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Enrollment_courseId_studentId_key" ON public."Enrollment" USING btree ("courseId", "studentId");


--
-- Name: Enrollment_studentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Enrollment_studentId_idx" ON public."Enrollment" USING btree ("studentId");


--
-- Name: assessment_attempts_assessmentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assessment_attempts_assessmentId_idx" ON public.assessment_attempts USING btree ("assessmentId");


--
-- Name: assessment_attempts_studentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assessment_attempts_studentId_idx" ON public.assessment_attempts USING btree ("studentId");


--
-- Name: assessments_chapterId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assessments_chapterId_idx" ON public.assessments USING btree ("chapterId");


--
-- Name: assessments_courseId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assessments_courseId_idx" ON public.assessments USING btree ("courseId");


--
-- Name: assessments_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assessments_scope_idx ON public.assessments USING btree (scope);


--
-- Name: assessments_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assessments_type_idx ON public.assessments USING btree (type);


--
-- Name: chapter_progress_chapterId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chapter_progress_chapterId_idx" ON public.chapter_progress USING btree ("chapterId");


--
-- Name: chapter_progress_chapterId_studentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chapter_progress_chapterId_studentId_key" ON public.chapter_progress USING btree ("chapterId", "studentId");


--
-- Name: chapter_progress_studentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chapter_progress_studentId_idx" ON public.chapter_progress USING btree ("studentId");


--
-- Name: chapters_courseId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chapters_courseId_idx" ON public.chapters USING btree ("courseId");


--
-- Name: chapters_courseId_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chapters_courseId_slug_key" ON public.chapters USING btree ("courseId", slug);


--
-- Name: chapters_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chapters_order_idx ON public.chapters USING btree ("order");


--
-- Name: course_reviews_courseId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "course_reviews_courseId_idx" ON public.course_reviews USING btree ("courseId");


--
-- Name: course_reviews_courseId_studentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "course_reviews_courseId_studentId_key" ON public.course_reviews USING btree ("courseId", "studentId");


--
-- Name: course_reviews_rating_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_reviews_rating_idx ON public.course_reviews USING btree (rating);


--
-- Name: course_reviews_studentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "course_reviews_studentId_idx" ON public.course_reviews USING btree ("studentId");


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: AssessmentQuestion AssessmentQuestion_assessmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AssessmentQuestion"
    ADD CONSTRAINT "AssessmentQuestion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES public.assessments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CourseInstructor CourseInstructor_courseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CourseInstructor"
    ADD CONSTRAINT "CourseInstructor_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CourseInstructor CourseInstructor_instructorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CourseInstructor"
    ADD CONSTRAINT "CourseInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Course Course_creatorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Course"
    ADD CONSTRAINT "Course_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Course Course_managerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Course"
    ADD CONSTRAINT "Course_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Enrollment Enrollment_courseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Enrollment"
    ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Enrollment Enrollment_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Enrollment"
    ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: assessment_attempts assessment_attempts_assessmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_attempts
    ADD CONSTRAINT "assessment_attempts_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES public.assessments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assessment_attempts assessment_attempts_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_attempts
    ADD CONSTRAINT "assessment_attempts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assessments assessments_chapterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT "assessments_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES public.chapters(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assessments assessments_courseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT "assessments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chapter_progress chapter_progress_chapterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chapter_progress
    ADD CONSTRAINT "chapter_progress_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES public.chapters(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chapter_progress chapter_progress_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chapter_progress
    ADD CONSTRAINT "chapter_progress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chapters chapters_courseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT "chapters_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: course_reviews course_reviews_courseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_reviews
    ADD CONSTRAINT "course_reviews_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES public."Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: course_reviews course_reviews_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_reviews
    ADD CONSTRAINT "course_reviews_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

