# PlacePrep AI Service

FastAPI service for resume extraction. `GET /health` reports service health. `POST /resume/parse` accepts PDF or DOCX bytes and returns structured fields, parse metadata, and warnings. Scanned PDFs use Tesseract OCR (English and Hindi) when available.

Run locally from this directory with a Python 3.11+ virtual environment, `pip install -r requirements.txt`, then `uvicorn app.main:app --reload --port 8000`. Docker installs Tesseract and the OCR language data.

The parser treats document content as data and performs deterministic extraction only; it does not call an LLM or follow instructions embedded in resumes. Structured parsing is fallible and should be reviewed by the candidate before use.
