Project Overview: LinkLanka (The AI Mediator)
This application, referred to as "LinkLanka" or "The AI Mediator" , is being developed as a university project for the SE2030 - Software Engineering course by a group of six team members.
+4

Detailed Project Description
LinkLanka is an AI-powered communication platform designed to break down modern language barriers in Sri Lanka. In current digital communications, many Sri Lankans converse using "Singlish" or "Tanglish"—which is Sinhala or Tamil written using English characters. Standard translation tools struggle with these mixed dialects because they attempt to translate the words literally.
+4

To solve this, LinkLanka acts as a mediator between informal, code-mixed speech and formal professional language. Instead of direct word-for-word translation, the application leverages Large Language Models to interpret the underlying intent and tone of the user. A user can type or speak natively in their preferred Singlish or Tanglish dialect, and the system will seamlessly deliver a properly structured, translated message to the recipient in their native or professional language.
+4

The project aims to serve three primary user groups:
s

University Students: To help them communicate seamlessly in group projects containing mixed-language speakers. It also allows them to formalize their casual chat logs into professional submission reports.
+1


Corporate Professionals: To bridge the communication gap between regional branch workers and corporate management.


General Public: To assist users who lack fluency in English but need to generate formal emails, documents, or communicate across mixed languages.

Project Scope
The scope of this project encompasses the development of a cohesive platform featuring several core functional modules designed for real-time messaging, audio processing, and document analysis.

In-Scope Core Features:


Real-Time Chat System: A bidirectional messaging system. Users can create groups, add members, and send text, voice, or document messages. The system will also queue messages locally when the client is offline.
+3


Text Translation Engine: The system will translate text messages from Tanglish, Singlish, or English into the user's desired language. The translation process is designed to manage conversational context and preserve the original tone of the message.
+2


Dialect Conversion: Users can convert standard text into formal or casual dialects. The system will also detect events from the text to create calendar entries and integrate with external apps to forward the generated text.
+1


Voice Translation: The application will record audio from the user's phone, compress the file, and check for audibility. It will then translate the spoken input into the desired language and provide feedback if the recording quality is too poor.
+1


Document Processing & OCR: Users can upload existing documents or scan new ones via their phone camera. The platform will simplify the document into a point format in the user's chosen language, allow users to click points to view the original source, and enable users to ask questions regarding the document's content.
+1


Personal Context Management: A personalization layer where users can add, edit, and define new slang or custom words. The translation pipeline will detect these words to inject their specific meaning. Widely used user additions will eventually grow into a system-wide knowledge base.
+2


User Management System: Standard profile capabilities including secure user registration, login/logout, password management, profile editing, and JWT authentication


Tech stack