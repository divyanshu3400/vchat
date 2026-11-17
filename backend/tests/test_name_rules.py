import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.names import name_problem

from .conftest import auth_client


@pytest.mark.parametrize(
    "name",
    ["Abhi", "night_owl", "Rahul.2004", "cricket_fan99", "Anonym_p", "a1b2"],
)
def test_good_names(name):
    assert name_problem(name, 20) is None


@pytest.mark.parametrize(
    "name, why",
    [
        ("abc", "At least 4"),
        ("ab", "At least 4"),
        ("1234", "Start with a letter"),
        ("_abcd", "Start with a letter"),
        ("abcd_", "End with a letter"),
        ("ab__cd", "No two"),
        ("a._bc", "No two"),
        ("a123", "at least 2 letters"),
        ("ravi9876543210", "phone number"),
        ("hi there", "no spaces"),
        ("x" * 21, "At most 20"),
        ("admin_raj", "reserved"),
        ("vchatteam", "reserved"),
        ("fuckboy", "isn't allowed"),
        ("mr_bhenchod", "isn't allowed"),
        ("sex_99", "isn't allowed"),
        ("bc_raju", "isn't allowed"),
    ],
)
def test_bad_names(name, why):
    problem = name_problem(name, 20)
    assert problem and why.lower() in problem.lower(), (name, problem)


def test_short_words_only_block_whole_parts():
    assert name_problem("sussex_fan", 20) is None  # "sex" inside a real word
    assert name_problem("classic_rock", 20) is None  # "ass" inside a real word


@pytest.mark.django_db
def test_signup_and_check_use_the_rules():
    res = APIClient().post("/api/auth/guest/", {"nickname": "123", "age_confirmed": True}, format="json")
    assert res.status_code == 400
    check = APIClient().get("/api/auth/handle/check/", {"handle": "9876543210"}).data
    assert check["available"] is False and check["reason"] == "invalid"
    assert APIClient().post("/api/auth/guest/", {"nickname": "Rahul_07", "age_confirmed": True}, format="json").status_code == 201


@pytest.mark.django_db
def test_old_short_username_can_still_be_kept_when_saving():
    guest = User.create_guest(nickname="abc", handle="abc")  # made before the rules
    res = auth_client(guest).post("/api/auth/account/save/", {"password": "milky-mint-42"}, format="json")
    assert res.status_code == 200 and res.data["user"]["handle"] == "abc"
