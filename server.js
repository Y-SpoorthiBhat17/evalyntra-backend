require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const { GridFSBucket } = require("mongodb");
const bodyParser = require("body-parser");
const path = require("path");

const Note = require("./models/Note");
const Video = require("./models/Video");
const Assignment = require("./models/Assignment");
const Quiz = require("./models/Quiz");
const User = require("./models/User");
const Course = require("./models/Course");
const { getCombinedClassData } = require("./groupController");

const app = express();
const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
  console.error("❌ MONGODB_URI is not set. Check your environment variables on Render.");
  process.exit(1);
}
mongoose.connect(mongoURI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });
app.use(cors({
  origin: [
    "https://evalyntra-frontend.onrender.com",
    "http://localhost:3000",
    "http://127.0.0.1:5500"
  ],
  credentials: true
}));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.static(__dirname));

const conn = mongoose.connection;
let gridfsBucket;

conn.once("open", () => {
  gridfsBucket = new GridFSBucket(conn.db, { bucketName: "notesFiles" });
  console.log("✅ GridFS initialized");
});

const upload = multer({ storage: multer.memoryStorage() });

/* ===== USER APIs ===== */
app.post("/api/register", async (req, res) => {
  try {
    const { name, role, college, branch, year, section, usn, subject, password } = req.body;
    const groupKey = `${college}|${branch}|${year}|${section}`;
    if (role === "student") {
      const exists = await User.findOne({ usn });
      if (exists) return res.status(400).json({ message: "USN already exists" });
    } else if (role === "lecturer") {
      // One lecturer per subject code per group (same lecturer can have multiple subjects)
      const existingLec = await User.findOne({ role: "lecturer", groupKey, subjectCode: req.body.subjectCode });
      if (existingLec) return res.status(400).json({ message: "A lecturer already exists for this subject code in this class" });
    }
    const user = new User({ name, role, college, branch, year, section, usn, subject, subjectCode: req.body.subjectCode, password, groupKey, email: req.body.email });
    
    await user.save();
    res.json({ message: "Account created successfully", user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { role, usn, name, password } = req.body;
    let user;
    if (role === "student") {
      user = await User.findOne({ usn, role: "student" });
      if (!user) return res.status(401).json({ message: "Student not found" });
    } else {
      const { name, email, subjectCode, password } = req.body;
      user = await User.findOne({
        role: "lecturer",
        name: name,
        email: email,
        subjectCode: subjectCode.toUpperCase(),
        password: password
      });
      if (!user) return res.status(401).json({ message: "Invalid credentials. Please check your name, email, subject code and password." });
    }
    res.json({ message: "Login successful", role: user.role, user, groupKey: user.groupKey });
  } catch (err) {
    res.status(500).json({ message: "Login server error" });
  }
});

/* Get all lecturers for a student's group key (student can have multiple subjects) */
app.get("/api/lecturers/:groupKey", async (req, res) => {
  const lecturers = await User.find({ role: "lecturer", groupKey: req.params.groupKey });
  res.json(lecturers);
});

/* ===== NOTES ===== */
app.post("/api/notes", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const filename = Date.now() + "-" + req.file.originalname;
    const uploadStream = gridfsBucket.openUploadStream(filename);
    uploadStream.end(req.file.buffer);
    uploadStream.on("finish", async () => {
      const note = new Note({ title: req.body.title, groupKey: req.body.groupKey, uploadedBy: req.body.uploadedBy, fileUrl: filename, fileId: uploadStream.id, subject: req.body.subject });
      await note.save();
      res.status(201).json({ message: "Note saved", data: note });
    });
  } catch (err) { res.status(500).json({ message: "Server error" }); }
});

app.get("/api/notes/:groupKey", async (req, res) => {
  try {
    const { subject, uploadedBy } = req.query;
    const query = { groupKey: req.params.groupKey };
    // Strict filter: only return notes for this exact subject
    if (subject) query.subject = subject;
    // Lecturer side: also filter by uploader so they only see their own
    if (uploadedBy) query.uploadedBy = uploadedBy;
    const notes = await Note.find(query).sort({ createdAt: -1 });
    res.json(notes);
  } catch(err) { res.status(500).json({ message: "Error fetching notes" }); }
});

app.get("/api/notes/file/:filename", (req, res) => {
  const downloadStream = gridfsBucket.openDownloadStreamByName(req.params.filename);
  res.setHeader("Content-Type", "application/pdf");
  downloadStream.pipe(res);
  downloadStream.on("error", () => res.status(404).json({ message: "File not found" }));
});

// Serve submission PDF files
app.get("/api/submissions/file/:filename", (req, res) => {
  const downloadStream = gridfsBucket.openDownloadStreamByName(decodeURIComponent(req.params.filename));
  res.setHeader("Content-Type", "application/pdf");
  downloadStream.pipe(res);
  downloadStream.on("error", () => res.status(404).json({ message: "Submission file not found" }));
});

// Serve assignment PDF files (uploaded by lecturer)
app.get("/api/assignments/file/:filename", (req, res) => {
  const downloadStream = gridfsBucket.openDownloadStreamByName(decodeURIComponent(req.params.filename));
  res.setHeader("Content-Type", "application/pdf");
  downloadStream.pipe(res);
  downloadStream.on("error", () => res.status(404).json({ message: "Assignment file not found" }));
});

app.delete("/api/notes/:id", async (req, res) => {
  await Note.findByIdAndDelete(req.params.id);
  res.json({ message: "Note deleted" });
});

/* ===== VIDEOS ===== */
app.post("/api/videos", async (req, res) => {
  try {
    const video = await Video.create(req.body);
    res.status(201).json({ message: "Video saved", data: video });
  } catch (err) { res.status(500).json({ message: "Error saving video" }); }
});

app.get("/api/videos/:groupKey", async (req, res) => {
  try {
    const { subject, uploadedBy } = req.query;
    const query = { groupKey: req.params.groupKey };
    // Strict filter: only return videos for this exact subject
    if (subject) query.subject = subject;
    // Lecturer side: also filter by uploader so they only see their own
    if (uploadedBy) query.uploadedBy = uploadedBy;
    const videos = await Video.find(query).sort({ createdAt: -1 });
    res.json(videos);
  } catch(err) { res.status(500).json({ message: "Error fetching videos" }); }
});

app.delete("/api/videos/:id", async (req, res) => {
  await Video.findByIdAndDelete(req.params.id);
  res.json({ message: "Video deleted" });
});

/* ===== ASSIGNMENTS ===== */
app.post("/api/assignments", upload.single("file"), async (req, res) => {
  try {
    let assignmentFileUrl = null;
    if (req.file) {
      const filename = "assignment-" + Date.now() + "-" + req.file.originalname;
      await new Promise((resolve, reject) => {
        const uploadStream = gridfsBucket.openUploadStream(filename);
        uploadStream.end(req.file.buffer);
        uploadStream.on("finish", resolve);
        uploadStream.on("error", reject);
      });
      assignmentFileUrl = filename;
    }
    const assignment = await Assignment.create({
      title: req.body.title, description: req.body.description,
      dueDate: req.body.dueDate, groupKey: req.body.groupKey,
      uploadedBy: req.body.uploadedBy, subject: req.body.subject,
      fileUrl: assignmentFileUrl, submissions: []
    });
    res.status(201).json({ message: "Assignment saved", data: assignment });
  } catch (err) { console.error(err); res.status(500).json({ message: "Error saving assignment" }); }
});

app.get("/api/assignments/:groupKey", async (req, res) => {
  try {
    const { subject, studentUSN, uploadedBy } = req.query;
    const query = { groupKey: req.params.groupKey };
    if (subject) query.subject = subject;
    if (uploadedBy) query.uploadedBy = uploadedBy;
    const assignments = await Assignment.find(query);
    const formatted = assignments.map(a => {
      const mySub = studentUSN ? a.submissions.find(s => s.studentUSN === studentUSN) : null;
      return {
        ...a._doc,
        alreadySubmitted: !!mySub,
        mySubmission: mySub ? mySub.fileUrl : null
      };
    });
    res.json(formatted);
  } catch (err) { res.status(500).json({ message: "Error fetching assignments" }); }
});

app.post("/api/assignments/submit/:id", upload.single("file"), async (req, res) => {
  try {
    const { studentUSN, studentName } = req.body;
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    if (new Date() > new Date(assignment.dueDate)) return res.status(400).json({ message: "Deadline passed" });

    // Remove existing submission
    assignment.submissions = assignment.submissions.filter(s => s.studentUSN !== studentUSN);

    let fileUrl = "text-submission";
    if (req.file) {
      // Save to GridFS so it can be retrieved later
      const filename = "submission-" + Date.now() + "-" + studentUSN + "-" + req.file.originalname;
      await new Promise((resolve, reject) => {
        const uploadStream = gridfsBucket.openUploadStream(filename);
        uploadStream.end(req.file.buffer);
        uploadStream.on("finish", resolve);
        uploadStream.on("error", reject);
      });
      fileUrl = filename;
    }
    assignment.submissions.push({ studentUSN, studentName, fileUrl, submittedAt: new Date() });
    await assignment.save();
    res.json({ message: "Assignment submitted successfully" });
  } catch (err) { console.error(err); res.status(500).json({ message: "Error submitting" }); }
});

app.delete("/api/assignments/submission/:id", async (req, res) => {
  try {
    const { studentUSN } = req.body;
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ message: "Not found" });
    assignment.submissions = assignment.submissions.filter(s => s.studentUSN !== studentUSN);
    await assignment.save();
    res.json({ message: "Submission deleted" });
  } catch (err) { res.status(500).json({ message: "Error deleting submission" }); }
});

app.delete("/api/assignments/:id", async (req, res) => {
  await Assignment.findByIdAndDelete(req.params.id);
  res.json({ message: "Assignment deleted" });
});

/* ===== QUIZZES ===== */
app.post("/api/quizzes", async (req, res) => {
  try {
    const quiz = await Quiz.create({ title: req.body.title, duration: req.body.duration, groupKey: req.body.groupKey, uploadedBy: req.body.uploadedBy, questions: req.body.questions, attempts: [], subject: req.body.subject, dueDate: req.body.dueDate, totalMarks: req.body.totalMarks || req.body.questions.length, aiGenerated: req.body.aiGenerated || false });
    res.status(201).json({ message: "Quiz saved", data: quiz });
  } catch (err) { res.status(500).json({ message: "Error saving quiz" }); }
});

app.get("/api/quizzes/:groupKey", async (req, res) => {
  try {
    const { subject, studentUSN, uploadedBy } = req.query;
    const query = { groupKey: req.params.groupKey };
    if (subject) query.subject = subject;
    if (uploadedBy) query.uploadedBy = uploadedBy;
    const quizzes = await Quiz.find(query);
    const formatted = quizzes.map(q => ({ ...q._doc, alreadyAttempted: studentUSN ? q.attempts.some(a => a.studentUSN === studentUSN) : false }));
    res.json(formatted);
  } catch (err) { res.status(500).json({ message: "Error fetching quizzes" }); }
});

app.post("/api/quizzes/attempt/:id", async (req, res) => {
  try {
    const { studentUSN, studentName, studentAnswers } = req.body;
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });
    if (quiz.dueDate && new Date() > new Date(quiz.dueDate)) return res.status(400).json({ message: "Quiz deadline passed" });
    if (quiz.attempts.some(a => a.studentUSN === studentUSN)) return res.status(400).json({ message: "Already attempted" });
    let score = 0;
    quiz.questions.forEach((q, i) => {
      const ans = studentAnswers[i];
      if (ans !== undefined && ans !== null && parseInt(ans) === q.answer.correct) score++;
    });
    quiz.attempts.push({ studentUSN, studentName, studentAnswers, score, attemptedAt: new Date() });
    await quiz.save();
    res.json({ message: "Quiz submitted", score, total: quiz.questions.length });
  } catch (err) { res.status(500).json({ message: "Error submitting quiz" }); }
});

app.delete("/api/quizzes/:id", async (req, res) => {
  await Quiz.findByIdAndDelete(req.params.id);
  res.json({ message: "Quiz deleted" });
});

app.get("/api/students", async (req, res) => {
  try {
    const { college, branch, year, section } = req.query;
    // filter by group if params provided; role lowercase matches schema
    const filter = { role: "student" };
    if (college) filter.college = college;
    if (branch)  filter.branch  = branch;
    if (year)    filter.year    = year;
    if (section) filter.section = section;
    const students = await User.find(filter).select("name usn college branch year section");
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: "Error fetching students" });
  }
});

/* ===== COURSES ===== */
app.get("/api/courses", async (req, res) => {
  try {
    const courses = await Course.find({});
    res.json(courses);
  } catch (err) { res.status(500).json({ message: "Error fetching courses" }); }
});

app.post("/api/courses/enroll", async (req, res) => {
  try {
    const { studentUSN, courseId } = req.body;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: "Course not found" });
    if (!course.enrolledStudents.includes(studentUSN)) {
      course.enrolledStudents.push(studentUSN);
      await course.save();
    }
    res.json({ message: "Enrolled successfully" });
  } catch (err) { res.status(500).json({ message: "Error enrolling" }); }
});

app.post("/api/courses/progress", async (req, res) => {
  try {
    const { studentUSN, courseId, lessonIndex } = req.body;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: "Course not found" });
    let prog = course.progress.find(p => p.studentUSN === studentUSN);
    if (!prog) {
      course.progress.push({ studentUSN, completedLessons: [lessonIndex] });
    } else {
      if (!prog.completedLessons.includes(lessonIndex)) prog.completedLessons.push(lessonIndex);
    }
    await course.save();
    // Check if all lessons done
    const isComplete = prog ? prog.completedLessons.length >= course.lessons.length : false;
    res.json({ message: "Progress saved", isComplete });
  } catch (err) { res.status(500).json({ message: "Error saving progress" }); }
});

app.get("/api/courses/student/:usn", async (req, res) => {
  try {
    const courses = await Course.find({ enrolledStudents: req.params.usn });
    const result = courses.map(c => {
      const prog = c.progress.find(p => p.studentUSN === req.params.usn);
      const completed = prog ? prog.completedLessons.length : 0;
      return { ...c._doc, completedCount: completed, isComplete: completed >= c.lessons.length };
    });
    res.json(result);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

/* ===== SEED COURSES ===== */
app.post("/api/seed-courses", async (req, res) => {
  try {
    const count = await Course.countDocuments();
    if (count >= 18) return res.json({ message: "Already seeded with 18 courses" });
    // Delete any partial seeds and reseed all 18
    await Course.deleteMany({});
    await Course.insertMany([
      {title:"DSA for Interviews",description:"Arrays, Strings, Trees, Graphs, DP — 200+ problems with explanations.",isPaid:false,price:0,thumbnail:"dsa",lessons:[
        {title:"Arrays & Strings",duration:60,videoUrl:"https://www.youtube.com/embed/RBSGKlAvoiM"},
        {title:"Recursion & Backtracking",duration:55,videoUrl:"https://www.youtube.com/embed/IJDJ0kBx2LM"},
        {title:"Trees & Graphs",duration:70,videoUrl:"https://www.youtube.com/embed/oSWTXtMglKE"},
        {title:"Dynamic Programming",duration:80,videoUrl:"https://www.youtube.com/embed/oBt53YbR9Kk"},
        {title:"System Design Basics",duration:65,videoUrl:"https://www.youtube.com/embed/xpDnVSmNFX0"}
      ]},
      {title:"JavaScript Mastery",description:"From basics to advanced JS — ES6+, DOM, Async, Promises.",isPaid:false,price:0,thumbnail:"js",lessons:[
        {title:"JS Fundamentals & ES6",duration:45,videoUrl:"https://www.youtube.com/embed/W6NZfCO5SIk"},
        {title:"DOM Manipulation",duration:50,videoUrl:"https://www.youtube.com/embed/5fb2aPlgoys"},
        {title:"Async JS & Promises",duration:60,videoUrl:"https://www.youtube.com/embed/DHvZLI7Db8E"},
        {title:"Fetch API & Projects",duration:55,videoUrl:"https://www.youtube.com/embed/cuEtnrL9-H0"}
      ]},
      {title:"React Fundamentals",description:"Build modern UIs with React — components, hooks, state, API.",isPaid:false,price:0,thumbnail:"react",lessons:[
        {title:"React Basics & JSX",duration:50,videoUrl:"https://www.youtube.com/embed/SqcY0GlETPk"},
        {title:"Components & Props",duration:55,videoUrl:"https://www.youtube.com/embed/Ke90Tje7VS0"},
        {title:"useState & useEffect",duration:65,videoUrl:"https://www.youtube.com/embed/TNhaISOUy6Q"},
        {title:"API Integration",duration:70,videoUrl:"https://www.youtube.com/embed/t2ypzz6gzmg"}
      ]},
      {title:"Python for Data Science",description:"NumPy, Pandas, Matplotlib — beginner friendly free course.",isPaid:false,price:0,thumbnail:"python",lessons:[
        {title:"Python Basics",duration:40,videoUrl:"https://www.youtube.com/embed/kqtD5dpn9C8"},
        {title:"NumPy & Pandas",duration:60,videoUrl:"https://www.youtube.com/embed/vmEHCJofslg"},
        {title:"Data Visualization",duration:55,videoUrl:"https://www.youtube.com/embed/a9UrKTVEeZA"}
      ]},
      {title:"Machine Learning Basics",description:"Supervised & unsupervised learning, sklearn, model evaluation.",isPaid:false,price:0,thumbnail:"ml",lessons:[
        {title:"Intro to ML & Types",duration:45,videoUrl:"https://www.youtube.com/embed/ukzFI9rgwfU"},
        {title:"Linear & Logistic Regression",duration:60,videoUrl:"https://www.youtube.com/embed/VmbA0pi2cRQ"},
        {title:"Decision Trees & Random Forest",duration:65,videoUrl:"https://www.youtube.com/embed/RmajweUFKvM"},
        {title:"Model Evaluation & sklearn",duration:55,videoUrl:"https://www.youtube.com/embed/0Lt9w-BxKFQ"}
      ]},
      {title:"Node.js & Express",description:"Build REST APIs with Node.js, Express and MongoDB.",isPaid:false,price:0,thumbnail:"node",lessons:[
        {title:"Node.js Fundamentals",duration:50,videoUrl:"https://www.youtube.com/embed/TlB_eWDSMt4"},
        {title:"Express & REST APIs",duration:60,videoUrl:"https://www.youtube.com/embed/pKd0Rpw7O48"},
        {title:"MongoDB & Mongoose",duration:65,videoUrl:"https://www.youtube.com/embed/-56x56UppqQ"}
      ]},
      {title:"HTML & CSS Mastery",description:"Modern responsive web design from scratch — Flexbox, Grid.",isPaid:false,price:0,thumbnail:"html",lessons:[
        {title:"HTML5 Fundamentals",duration:40,videoUrl:"https://www.youtube.com/embed/UB1O30fR-EE"},
        {title:"CSS Flexbox & Grid",duration:55,videoUrl:"https://www.youtube.com/embed/JJSoEo8JSnc"},
        {title:"Responsive Design",duration:50,videoUrl:"https://www.youtube.com/embed/srvUrASNj0s"}
      ]},
      {title:"Git & GitHub",description:"Version control, branching, pull requests, collaboration.",isPaid:false,price:0,thumbnail:"git",lessons:[
        {title:"Git Basics & Setup",duration:35,videoUrl:"https://www.youtube.com/embed/RGOj5yH7evk"},
        {title:"Branching & Merging",duration:40,videoUrl:"https://www.youtube.com/embed/S2TUommS3O0"},
        {title:"GitHub & Collaboration",duration:45,videoUrl:"https://www.youtube.com/embed/nhNq2kIvi9s"}
      ]},
      {title:"SQL & Databases",description:"Relational databases, SQL queries, joins, normalization.",isPaid:false,price:0,thumbnail:"sql",lessons:[
        {title:"SQL Basics & DDL",duration:45,videoUrl:"https://www.youtube.com/embed/HXV3zeQKqGY"},
        {title:"Joins & Subqueries",duration:55,videoUrl:"https://www.youtube.com/embed/9URM1_2S0ho"},
        {title:"Indexing & Normalization",duration:50,videoUrl:"https://www.youtube.com/embed/ztHopE5Wnpc"}
      ]},
      {title:"Operating Systems",description:"Processes, threads, scheduling, memory management, deadlocks.",isPaid:false,price:0,thumbnail:"os",lessons:[
        {title:"Process & Threads",duration:50,videoUrl:"https://www.youtube.com/embed/exbKr6fnoUw"},
        {title:"CPU Scheduling",duration:55,videoUrl:"https://www.youtube.com/embed/vF3KKMI3_1s"},
        {title:"Memory Management",duration:60,videoUrl:"https://www.youtube.com/embed/p9yZNLeOj4s"},
        {title:"Deadlocks & Synchronization",duration:55,videoUrl:"https://www.youtube.com/embed/s4h_iMiGHiM"}
      ]},
      {title:"Computer Networks",description:"OSI model, TCP/IP, HTTP, DNS, routing protocols.",isPaid:false,price:0,thumbnail:"cn",lessons:[
        {title:"OSI & TCP/IP Model",duration:45,videoUrl:"https://www.youtube.com/embed/vv4y_uOneC0"},
        {title:"IP Addressing & Subnetting",duration:55,videoUrl:"https://www.youtube.com/embed/EkNq4TrHP_U"},
        {title:"HTTP, DNS & Routing",duration:50,videoUrl:"https://www.youtube.com/embed/AlkDbnbv7dk"}
      ]},
      {title:"Object Oriented Programming",description:"OOP concepts in Java/C++ — classes, inheritance, polymorphism.",isPaid:false,price:0,thumbnail:"oop",lessons:[
        {title:"Classes & Objects",duration:45,videoUrl:"https://www.youtube.com/embed/pTB0EiLXUC8"},
        {title:"Inheritance & Polymorphism",duration:55,videoUrl:"https://www.youtube.com/embed/Lot6V-TExGk"},
        {title:"Abstraction & Encapsulation",duration:50,videoUrl:"https://www.youtube.com/embed/9T8NZGHlFIg"}
      ]},
      {title:"C Programming",description:"Fundamentals of C — pointers, memory, file I/O, data structures.",isPaid:false,price:0,thumbnail:"c",lessons:[
        {title:"C Basics & Syntax",duration:40,videoUrl:"https://www.youtube.com/embed/KJgsSFOSQv0"},
        {title:"Pointers & Memory",duration:55,videoUrl:"https://www.youtube.com/embed/zuegQmMdy8M"},
        {title:"Structures & File I/O",duration:50,videoUrl:"https://www.youtube.com/embed/Ks0HLMzFulo"}
      ]},
      {title:"Android Development",description:"Build Android apps using Java/Kotlin — UI, intents, databases.",isPaid:false,price:0,thumbnail:"android",lessons:[
        {title:"Android Basics & Setup",duration:50,videoUrl:"https://www.youtube.com/embed/EOfCEhWq8sg"},
        {title:"Activities & Intents",duration:60,videoUrl:"https://www.youtube.com/embed/cFbAHrWTK5c"},
        {title:"SQLite & SharedPrefs",duration:55,videoUrl:"https://www.youtube.com/embed/x2LtzYiONO8"}
      ]},
      {title:"DevOps & Docker",description:"CI/CD, Docker containers, deployment, Linux basics.",isPaid:false,price:0,thumbnail:"devops",lessons:[
        {title:"Linux Basics",duration:45,videoUrl:"https://www.youtube.com/embed/ROjZy1WbCIA"},
        {title:"Docker Fundamentals",duration:60,videoUrl:"https://www.youtube.com/embed/fqMOX6JJhGo"},
        {title:"CI/CD & Deployment",duration:55,videoUrl:"https://www.youtube.com/embed/scEDHsr3APg"}
      ]},
      {title:"Cybersecurity Basics",description:"Network security, ethical hacking intro, cryptography, OWASP.",isPaid:false,price:0,thumbnail:"cyber",lessons:[
        {title:"Security Fundamentals",duration:45,videoUrl:"https://www.youtube.com/embed/hXSFdwIOfnE"},
        {title:"Cryptography & Hashing",duration:55,videoUrl:"https://www.youtube.com/embed/AQDCe585Lnc"},
        {title:"Web Security & OWASP",duration:50,videoUrl:"https://www.youtube.com/embed/-ENuTHi6Qhc"}
      ]},
      {title:"Cloud Computing (AWS)",description:"AWS services, EC2, S3, Lambda, cloud deployment basics.",isPaid:false,price:0,thumbnail:"cloud",lessons:[
        {title:"Cloud Basics & AWS Intro",duration:45,videoUrl:"https://www.youtube.com/embed/a9__D53WsUs"},
        {title:"EC2, S3 & IAM",duration:60,videoUrl:"https://www.youtube.com/embed/IT1X42D1KeA"},
        {title:"Lambda & Serverless",duration:55,videoUrl:"https://www.youtube.com/embed/97q30JjEq9Y"}
      ]},
      {title:"Soft Skills & Communication",description:"Resume writing, interview skills, communication, group discussion.",isPaid:false,price:0,thumbnail:"soft",lessons:[
        {title:"Resume & LinkedIn Building",duration:35,videoUrl:"https://www.youtube.com/embed/y8YH0QnMXoA"},
        {title:"Communication & Presentation",duration:40,videoUrl:"https://www.youtube.com/embed/HAnw168huqA"},
        {title:"Group Discussion & HR Prep",duration:45,videoUrl:"https://www.youtube.com/embed/e-ZdaOhHnXU"}
      ]}
    ]);
    res.json({ message: "18 courses seeded successfully" });
  } catch(err) { res.status(500).json({ message: "Seed error", err }); }
});

app.get("/api/active-lecture/:groupKey", async (req, res) => {
  const lecturer = await User.findOne({ role: "lecturer", groupKey: req.params.groupKey });
  if (lecturer) res.json({ subject: lecturer.subject });
  else res.status(404).json({ message: "No active lecture" });
});

app.get("/api/class-group", getCombinedClassData);

/* ===== AUTO-ASSIGN ZERO FOR UNATTEMPTED EXPIRED QUIZZES ===== */
/*
  POST /api/quizzes/assign-zeros/:quizId
  Called by lecturer dashboard when a quiz is expired.
  Finds all students in the quiz's groupKey who never attempted,
  and inserts a score:0 attempt for each of them.
  Safe to call multiple times — skips students already assigned.
*/
app.post("/api/quizzes/assign-zeros/:quizId", async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });

    // Only auto-assign if quiz is actually expired
    if (!quiz.dueDate || new Date() <= new Date(quiz.dueDate)) {
      return res.status(400).json({ message: "Quiz is not expired yet" });
    }

    // Get all students in this quiz's group and subject
    // groupKey format: "college|branch|year|section"
    const parts = quiz.groupKey.split("|");
    const [college, branch, year, section] = parts;

    const allStudents = await User.find({
      role: "student",
      college,
      branch,
      year,
      section
    }).select("name usn");

    if (allStudents.length === 0) {
      return res.status(200).json({ message: "No students found in this group", assigned: 0 });
    }

    // Find USNs of students who already have an attempt (including previously auto-assigned zeros)
    const attemptedUSNs = new Set(quiz.attempts.map(a => a.studentUSN));

    // Filter to only unattempted students
    const unattempted = allStudents.filter(s => !attemptedUSNs.has(s.usn));

    if (unattempted.length === 0) {
      return res.status(200).json({ message: "All students already have attempts", assigned: 0 });
    }

    // Push zero-score attempt for each unattempted student
    const zeroAttempts = unattempted.map(s => ({
      studentUSN: s.usn,
      studentName: s.name,
      studentAnswers: {},
      score: 0,
      attemptedAt: new Date(quiz.dueDate), // mark as attempted at due date
      autoAssigned: true                   // flag so frontend can show "Not Attempted"
    }));

    quiz.attempts.push(...zeroAttempts);
    await quiz.save();

    res.json({
      message: `Assigned 0 to ${unattempted.length} unattempted student(s)`,
      assigned: unattempted.length,
      students: unattempted.map(s => ({ name: s.name, usn: s.usn }))
    });

  } catch (err) {
    console.error("assign-zeros error:", err);
    res.status(500).json({ message: "Error assigning zeros", error: err.message });
  }
});

/* ===== GET FULL QUIZ RESULTS (attempted + unattempted) for lecturer ===== */
/*
  GET /api/quizzes/results/:quizId
  Returns all attempts including auto-assigned zeros.
  Also returns totalStudents in the group for the lecturer dashboard count.
*/
app.get("/api/quizzes/results/:quizId", async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });

    const parts = quiz.groupKey.split("|");
    const [college, branch, year, section] = parts;

    const allStudents = await User.find({
      role: "student",
      college,
      branch,
      year,
      section
    }).select("name usn");

    const totalStudents = allStudents.length;
    const attemptedCount = quiz.attempts.filter(a => !a.autoAssigned).length;
    const unattemptedCount = quiz.attempts.filter(a => a.autoAssigned).length;

    res.json({
      quizId: quiz._id,
      title: quiz.title,
      subject: quiz.subject,
      totalMarks: quiz.totalMarks || quiz.questions.length,
      dueDate: quiz.dueDate,
      isExpired: quiz.dueDate ? new Date() > new Date(quiz.dueDate) : false,
      totalStudents,
      attemptedCount,
      unattemptedCount,
      attempts: quiz.attempts.map(a => ({
        studentUSN: a.studentUSN,
        studentName: a.studentName,
        score: a.score,
        attemptedAt: a.attemptedAt,
        status: a.autoAssigned ? "Not Attempted" : "Attempted"
      }))
    });

  } catch (err) {
    res.status(500).json({ message: "Error fetching results", error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Backend is running");
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


/* ===== EDIT ROUTES ===== */
app.put("/api/notes/:id", async (req, res) => {
  try { const n = await Note.findByIdAndUpdate(req.params.id, { title: req.body.title }, { new: true }); res.json(n); }
  catch(e) { res.status(500).json({ message: "Error" }); }
});
app.put("/api/videos/:id", async (req, res) => {
  try { const v = await Video.findByIdAndUpdate(req.params.id, { title: req.body.title, link: req.body.link }, { new: true }); res.json(v); }
  catch(e) { res.status(500).json({ message: "Error" }); }
});
app.put("/api/assignments/:id", async (req, res) => {
  try { const a = await Assignment.findByIdAndUpdate(req.params.id, { title: req.body.title, description: req.body.description, dueDate: req.body.dueDate }, { new: true }); res.json(a); }
  catch(e) { res.status(500).json({ message: "Error" }); }
});

/* ===== QUIZ NOTIFICATION STORE ===== */
// Simple in-memory store for quiz notifications (students poll this)
const quizNotifications = {};

app.post("/api/notify-quiz", (req, res) => {
  const { groupKey, subject, quizTitle, dueDate, lecturerName } = req.body;
  if (!groupKey) return res.status(400).json({ message: "Missing groupKey" });
  if (!quizNotifications[groupKey]) quizNotifications[groupKey] = [];
  quizNotifications[groupKey].push({
    id: Date.now(),
    subject, quizTitle, dueDate, lecturerName,
    createdAt: new Date().toISOString()
  });
  // Keep only last 20
  if (quizNotifications[groupKey].length > 20) quizNotifications[groupKey].shift();
  res.json({ message: "Notification queued" });
});

app.get("/api/quiz-notifications/:groupKey", (req, res) => {
  const list = quizNotifications[req.params.groupKey] || [];
  res.json(list);
});


/* ===== RESET COURSES (run once to clear old 4 courses) ===== */
app.post("/api/reset-courses", async (req, res) => {
  try {
    await Course.deleteMany({});
    res.json({ message: "All courses deleted. Reload student dashboard to reseed 18 courses." });
  } catch(err) { res.status(500).json({ message: "Error", err }); }
});

/* ===== AI PROXY (Gemini 2.0 Flash) ===== */
const https = require("https");
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
function callGemini(prompt, res) {

  const body = JSON.stringify({
    model: "openai/gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  });

  const options = {
    hostname: "openrouter.ai",
    path: "/api/v1/chat/completions",
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    }
  };

  const req = https.request(options, (apiRes) => {

    let data = "";

    apiRes.on("data", chunk => {
      data += chunk;
    });

    apiRes.on("end", () => {

      try {

        console.log("OpenRouter Status:", apiRes.statusCode);

        const parsed = JSON.parse(data);

        if (parsed.error) {
          return res.status(500).json({
            error: parsed.error.message
          });
        }

        const text =
          parsed?.choices?.[0]?.message?.content || "";

        if (!text) {
          return res.status(500).json({
            error: "No response text"
          });
        }

        res.json({
          result: text
        });

      } catch (e) {

        console.error("Parse Error:", e.message);

        res.status(500).json({
          error: e.message
        });

      }

    });

  });

  req.on("error", err => {

    console.error("Network Error:", err.message);

    res.status(500).json({
      error: err.message
    });

  });

  req.setTimeout(45000, () => {

    req.destroy();

    res.status(500).json({
      error: "Request timeout"
    });

  });

  req.write(body);
  req.end();
}

/* Resume Analyzer — keyword-based scoring, stores history */
const ResumeHistory = mongoose.model("ResumeHistory", new mongoose.Schema({
  studentUSN: String,
  jobRole: String,
  score: Number,
  matchedKeywords: [String],
  missingKeywords: [String],
  tips: [String],
  analyzedAt: { type: Date, default: Date.now }
}));

const JOB_KEYWORDS = {
  "Frontend Developer (React / Next.js)": {
    required: ["react","javascript","html","css","nextjs","typescript","redux","git","responsive","dom","hooks","component","api","rest","npm"],
    senior: ["architecture","performance","testing","jest","ci/cd","webpack","micro-frontend","team lead","mentoring","3 years","4 years","5 years"]
  },
  "Backend Developer (Node.js / Python)": {
    required: ["node","express","python","rest","api","mongodb","sql","database","authentication","jwt","git","json","server","http","backend"],
    senior: ["microservices","docker","kubernetes","aws","scaling","redis","architecture","system design","4 years","5 years","6 years","team"]
  },
  "Full Stack Developer": {
    required: ["html","css","javascript","react","node","express","mongodb","sql","git","api","rest","database","frontend","backend","responsive"],
    senior: ["docker","aws","ci/cd","testing","typescript","architecture","5 years","6 years","team lead"]
  },
  "Data Analyst": {
    required: ["python","sql","excel","pandas","numpy","visualization","tableau","powerbi","statistics","data","analysis","matplotlib","report","dashboard","cleaning"],
    senior: ["machine learning","predictive","big data","spark","hadoop","advanced sql","5 years","4 years","team","stakeholder"]
  },
  "Data Scientist": {
    required: ["python","machine learning","statistics","pandas","numpy","sklearn","tensorflow","sql","data","model","regression","classification","jupyter","feature engineering","matplotlib"],
    senior: ["deep learning","nlp","computer vision","mlops","production","deployment","phd","research","5 years","6 years","architecture"]
  },
  "Machine Learning Engineer": {
    required: ["python","tensorflow","pytorch","sklearn","machine learning","deep learning","neural network","data","model","numpy","pandas","git","rest","deployment","docker"],
    senior: ["mlops","kubernetes","distributed","production","research","architecture","5 years","6 years","gcp","aws","azure"]
  },
  "DevOps Engineer": {
    required: ["docker","kubernetes","linux","git","ci/cd","jenkins","ansible","terraform","aws","bash","monitoring","deployment","pipeline","nginx","python"],
    senior: ["architecture","cloud","security","cost optimization","team lead","5 years","6 years","microservices","observability","sre"]
  },
  "Mobile App Developer (Android / iOS)": {
    required: ["android","kotlin","java","ios","swift","mobile","ui","xml","activity","intent","rest","api","git","sqlite","firebase"],
    senior: ["architecture","mvvm","rxjava","flutter","react native","5 years","team","publishing","playstore","appstore"]
  },
  "UI/UX Designer": {
    required: ["figma","sketch","ui","ux","wireframe","prototype","design","user research","css","html","typography","color","accessibility","adobe","user testing"],
    senior: ["design system","team lead","stakeholder","strategy","research","5 years","product","brand","mentoring"]
  },
  "Cybersecurity Analyst": {
    required: ["security","network","firewall","linux","python","vulnerability","penetration","nmap","wireshark","owasp","encryption","authentication","incident","siem","compliance"],
    senior: ["team lead","architecture","forensics","red team","blue team","ceh","cissp","5 years","threat intelligence","iso 27001"]
  },
  "Cloud Engineer (AWS / Azure / GCP)": {
    required: ["aws","azure","gcp","cloud","ec2","s3","lambda","docker","terraform","linux","networking","iam","storage","compute","scripting"],
    senior: ["architecture","cost optimization","multi-cloud","kubernetes","security","compliance","5 years","devops","migration","enterprise"]
  },
  "Software Testing / QA Engineer": {
    required: ["testing","selenium","manual","automation","testng","junit","regression","bug","jira","sql","api","postman","agile","git","quality"],
    senior: ["framework","performance testing","jmeter","test strategy","team lead","5 years","ci/cd","test architecture","mentoring"]
  },
  "Database Administrator": {
    required: ["sql","mysql","postgresql","oracle","database","backup","performance","indexing","query","tuning","linux","stored procedure","replication","monitoring","security"],
    senior: ["high availability","architecture","cloud","migration","sharding","team","5 years","6 years","disaster recovery","compliance"]
  },
  "AI/ML Research Engineer": {
    required: ["python","deep learning","tensorflow","pytorch","research","paper","nlp","computer vision","mathematics","statistics","cuda","transformers","optimization","numpy","jupyter"],
    senior: ["phd","publication","conference","neurips","icml","team","5 years","novel","architecture","large language model"]
  },
  "Embedded Systems Engineer": {
    required: ["embedded","c","c++","microcontroller","arduino","rtos","uart","spi","i2c","firmware","hardware","pcb","assembly","linux","debugging"],
    senior: ["architecture","team","5 years","6 years","optimization","automotive","safety","certification","mentoring","system design"]
  },
  "Network Engineer": {
    required: ["cisco","routing","switching","tcp/ip","network","firewall","vlan","bgp","ospf","linux","troubleshooting","dns","dhcp","vpn","monitoring"],
    senior: ["architecture","team lead","5 years","security","cloud","automation","python","sdn","enterprise","certification"]
  },
  "Product Manager": {
    required: ["product","roadmap","agile","scrum","user story","stakeholder","analytics","jira","wireframe","market","kpi","launch","communication","prioritization","data"],
    senior: ["strategy","team lead","p&l","enterprise","5 years","okr","leadership","go-to-market","growth","monetization"]
  },
  "Technical Support Engineer": {
    required: ["troubleshooting","linux","windows","networking","ticketing","sql","api","documentation","customer","support","scripting","hardware","software","escalation","communication"],
    senior: ["team lead","mentoring","process","5 years","automation","cloud","escalation","knowledge base","metrics","sla"]
  }
};

function extractTextFromPDF(base64) {
  // Basic ASCII extraction from base64
  try {
    const buf = Buffer.from(base64, 'base64').toString('latin1');
    return buf.replace(/[^a-zA-Z0-9\s.+#@,/]/g, ' ').toLowerCase();
  } catch(e) { return ''; }
}

app.post("/api/analyze-resume", async (req, res) => {
  const { pdfBase64, jobRole, studentUSN } = req.body;
  if (!pdfBase64 || !jobRole) return res.status(400).json({ error: "Missing pdfBase64 or jobRole" });
  
  const text = extractTextFromPDF(pdfBase64);
  const jobData = JOB_KEYWORDS[jobRole] || JOB_KEYWORDS["Full Stack Developer"];
  const required = jobData.required;
  const senior = jobData.senior;
  
  const matched = required.filter(k => text.includes(k.toLowerCase()));
  const missing = required.filter(k => !text.includes(k.toLowerCase()));
  const seniorMatched = senior.filter(k => text.includes(k.toLowerCase()));
  
  const baseScore = Math.round((matched.length / required.length) * 75);
  const seniorBonus = Math.min(25, Math.round((seniorMatched.length / senior.length) * 25));
  const score = Math.min(100, baseScore + seniorBonus);
  
  const level = score >= 70 ? "Senior" : score >= 45 ? "Mid-level" : "Fresher/Junior";
  
  const tips = [];
  if (missing.length > 0) tips.push(`Add these missing skills: ${missing.slice(0,4).join(", ")}`);
  if (seniorMatched.length < 3) tips.push("Add years of experience and leadership/project details for better senior-level score");
  if (!text.includes("project")) tips.push("Add more project descriptions with tech stack mentioned");
  if (!text.includes("github") && !text.includes("linkedin")) tips.push("Add your GitHub and LinkedIn profile links");
  if (score < 50) tips.push("Focus on building projects using the required technologies for this role");
  if (text.length < 500) tips.push("Your resume seems short — add more detail about experience and projects");
  
  const result = { matchScore: score, level, summary: `Your resume is a ${level} match (${score}%) for ${jobRole}.`, strengths: matched.slice(0,5).map(k => `Has: ${k}`), missingSkills: missing.slice(0,6), improvements: tips.slice(0,4), seniorKeywords: seniorMatched };
  
  // Save to history
  if (studentUSN) {
    try {
      await ResumeHistory.create({ studentUSN, jobRole, score, matchedKeywords: matched, missingKeywords: missing.slice(0,6), tips: tips.slice(0,4) });
    } catch(e) { /* ignore */ }
  }
  res.json(result);
});

app.get("/api/resume-history/:usn", async (req, res) => {
  try {
    const history = await ResumeHistory.find({ studentUSN: req.params.usn }).sort({ analyzedAt: -1 }).limit(10);
    res.json(history);
  } catch(e) { res.status(500).json({ error: "History error" }); }
});

/* AI Quiz Generator */
app.post("/api/generate-quiz", (req, res) => {
  const { topic, count } = req.body;
  if (!topic) return res.status(400).json({ error: "Missing topic" });
  const n = parseInt(count) || 5;
  const prompt = `Generate exactly ${n} multiple choice quiz questions about "${topic}" for engineering college students.
Return ONLY a valid JSON array. No markdown, no explanation, no code fences. Example format:
[{"question":"What is ...?","options":["Option A","Option B","Option C","Option D"],"correctIndex":0}]
correctIndex is the 0-based index of the correct option. Make questions clear, educational and accurate.`;
  callGemini(prompt, res);
});

/* ===== RESET PASSWORD ===== */
app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ message: "Missing fields" });
    if (newPassword.length < 6) return res.status(400).json({ message: "Password too short" });
    // Update ALL records with this email (lecturer may have multiple subjects)
    const result = await User.updateMany(
      { role: "lecturer", email },
      { $set: { password: newPassword } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ message: "No lecturer found with that email." });
    res.json({ message: `Password reset successful for ${result.matchedCount} subject(s).` });
  } catch(err) {
    res.status(500).json({ message: "Server error" });
  }
});