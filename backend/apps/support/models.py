from django.conf import settings
from django.db import models


class ContactMessage(models.Model):
    """A message from the contact page. Also emailed to SUPPORT_EMAIL; this copy is the record."""

    class Topic(models.TextChoices):
        QUESTION = "question", "A question"
        PROBLEM = "problem", "Something isn't working"
        ABUSE = "abuse", "Report abuse or safety"
        GRIEVANCE = "grievance", "Grievance (IT Rules)"
        ACCOUNT = "account", "My account or data"
        PLUS = "plus", "vChat Plus or payments"
        OTHER = "other", "Something else"

    topic = models.CharField(max_length=12, choices=Topic.choices)
    name = models.CharField(max_length=80, blank=True)
    email = models.EmailField()
    message = models.TextField(max_length=4000)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    emailed = models.BooleanField(default=False)
    handled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.get_topic_display()} from {self.email}"
