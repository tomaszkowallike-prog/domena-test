// Script Scroll To Top
    $(document).ready(function() {
      $().UItoTop({ easingType: 'easeOutQuart' });
    });
// END Script Scroll To Top
// ANIMATION
 // wow = new WOW({
 //     boxClass: 'wow', // default
 //     animateClass: 'animated', // default
 //     offset: 0, // default
 //     mobile: true, // default
 //     live: true // default
 // })
 // wow.init();
// END ANIMATION
// SCROLLING
$('a[href^="#"]').click(function(e) {
    e.preventDefault();
});

function detectLeftButton(event) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return false;
    } else if ('buttons' in event) {
        return event.buttons === 1;
    } else if ('which' in event) {
        return event.which === 1;
    } else {
        return (event.button == 1 || event.type == 'click');
    }
}

$(document).on('click', 'a[href^="#"]:not([data-toggle])', function (event) {
    event.preventDefault();
    $('html, body').animate({
        scrollTop: $($.attr(this, 'href')).offset().top
    }, 1000, "easeInOutExpo");
});

$(document).on('mousedown', '.bx-viewport a', function (event) {
    event.preventDefault();
    if (detectLeftButton(event)) {
        let h = $(this).attr('href');

        if (h === '#') {
            return;
        }
        if (h.startsWith('#')) {
            $('html, body').animate({
                scrollTop: $($.attr(this, 'href')).offset().top
            }, 1000, "easeInOutExpo");
        } else if (h.length>0) {
            if($(this).data('lightbox')) {
                $(this).click();
            } else {
                document.location.href = ($(this).attr('href'));
            }

        }
    }
});

// END SCROLLING
// TOOLTIP
$(function () {
  $('[data-toggle="tooltip"]').tooltip({ delay: 0 });
});
// END TOOLTIP
// Bootstrap Dropdown Menu Hover
// $('.navbar .dropdown > a').click(function() {
//   location.href = this.href;
// });
// if(( $(window).width() > 1199 )) {
//   $('.navbar .dropdown').hover(function() {
//     $(this).find('.dropdown-menu').first().stop(true, true).delay(300).slideDown();
//   }, function() {
//     $(this).find('.dropdown-menu').first().stop(true, true).delay(300).slideUp();
//   });
// }
  // Menu Dropdown Animation
    $('.dropdown').on('show.bs.dropdown', function(e){
      $(this).find('.dropdown-menu').first().stop(true, true).slideDown(300);
    });
    $('.dropdown').on('hide.bs.dropdown', function(e){
      $(this).find('.dropdown-menu').first().stop(true, true).slideUp(300);
    });
  // End Menu Dropdown Animation
// END Bootstrap Dropdown Menu Hover
// reCaptcha
  function onSubmit(token) {
      document.getElementById("i-recaptcha").submit();
  }
// END reCaptcha
// CONTACT FORM

$(function() {
    var msgok = function(form) {
        $(form).find('#success').html("<div class='alert alert-success alert-dismissible rounded-0 fade show' role='alert'>");
        $(form).find('#success > .alert-success').html("<strong>Twoja wiadomość e-mail została wysłana! </strong>");
        $(form).find('#success > .alert-success')
            .append("<button type='button' class='close' data-dismiss='alert' aria-label='close'><span aria-hidden='true'>x");
        $(form).find('#success > .alert-success')
            .append("</span></button>");
        let msgOnSuccess = $(form).data('msgonsuccess');
        if (msgOnSuccess) {
            let mosParagraph = $('<p>').addClass('mt-2 mb-1').text(msgOnSuccess);
            $(form).find('#success > .alert-success').append(mosParagraph);
        }
        $(form).find('#success')
            .append('</div>');
    }

    var msgfail = function(form, msg) {
        if (!msg) {
            msg = "<strong>Przykro nam, twoja wiadomość e-mail nie została wysłana! Prosimy spróbować później.</strong>";
        } else {
            msg = "<strong>"+$('<div/>').text(msg).html()+"</strong>";
        }
        $(form).find('#success').html("<div class='alert alert-danger alert-dismissible fade show' role='alert'>");
        $(form).find('#success > .alert-danger').html(msg);
        $(form).find('#success > .alert-danger')
            .append("<button type='button' class='close' data-dismiss='alert' aria-label='close'><span aria-hidden='true'>x");
        $(form).find('#success > .alert-danger')
            .append("</span></button>");
        $(form).find('#success')
            .append('</div>');
    }
  $("form[name='form-newsletter']").on("submit", function(e){
      e.preventDefault();
      var $form = this;
      grecaptcha.ready(function() {
          // do request for recaptcha token
          // response is promise with passed token
          grecaptcha.enterprise.execute(recaptcha_key, {action: 'newsletter'}).then(function(token) {
              // add token to form
              $($form).prepend('<input type="hidden" name="token" value="' + token + '">');
              $($form).prepend('<input type="hidden" name="action" value="newsletter">');
              // submit form now
              //$('form').unbind('submit').submit();
              $form.submit();
          });
      });


  });
  $("form[name='form-main'],form[name='form-price'],form[name='form-price-front'],form[name='form-small-domain'],form[name='form-ssl'],form[name='form-dsa'],form[name='form-sklepy']").find('input,select,textarea').jqBootstrapValidation({
    preventSubmit: true,
    submitError: function($form, event, errors) {
      // additional error messages or events
    },
    submitSuccess: function($form, event) {
      event.preventDefault(); // prevent default submit behaviour
      // get values from FORM
      $this = $("#submit");
      $this.prop("disabled", true); // Disable submit button until AJAX call is complete to prevent duplicate messages
      $this.text('Wysyłam...');


      var sendMail = function() {
          $.ajax({
              url: $form.attr('action'),
              type: "POST",
              data: $form.serialize(),
              cache: false,
              success: function(data) {
                  // Success message
                  if (data.status == 'ok') {
                      msgok($form);
                      //clear all fields
                      $form.trigger("reset");
                  } else if($(data.errors).length>0) {
                      for(var i in data.errors) {
                          if (i.endsWith('[]')) {
                              i = i.substring(0, i.length - 2);
                          }
                          var fel = $form.find('[name="'+i+'"]');

                          if (fel.length == 0) {
                              fel = $form.find('[name="'+i+'[]"]');
                              if (fel.length>0) {
                                  fel = $(fel[0]);
                              }

                          }
                          var ferr = $(fel).attr('data-validation-'+data.errors[i]+'-message');
                          $controlGroup = fel.parents(".form-group").first();
                          $helpBlock = $controlGroup.find(".help-block").first();
                          if (typeof ferr === 'undefined') {
                              $helpBlock.html(data.errors[i]);
                          } else {
                              $helpBlock.html(ferr);
                          }
                      }
                  } else {
                      msgfail($form, data.global_error);
                  }

              },
              error: function(data) {
                  // Fail message
                  msgfail($form);
                  //clear all fields
                  $form.trigger("reset");
              },
              complete: function(data) {
                  setTimeout(function() {
                      $this.prop("disabled", false); // Re-enable submit button when AJAX call is complete
                      $this.text('Wyślij');
                  }, 1000);
              }
          });
      }

      var formName = $($form).attr('name') || 'unknown';
      var actionName = formName.replace('form-', '').replace(/-/g, '_');

    grecaptcha.enterprise.ready(function() {
        // do request for recaptcha token
        // response is promise with passed token
        grecaptcha.enterprise.execute(recaptcha_key, {action: actionName}).then(function(token) {
            // add token to form
            if ($($form).find('input[name="token"]').length) {
                $($form).find('input[name="token"]').val(token);
            } else {
                $($form).prepend('<input type="hidden" name="token" value="' + token + '">');
            }

            if ($($form).find('input[name="action"]').length) {
                $($form).find('input[name="action"]').val(actionName);
            } else {
                $($form).prepend('<input type="hidden" name="action" value="' + actionName + '">');
            }
            // submit form now
            //$('form').unbind('submit').submit();
            sendMail();
        });
    });



      //var response = grecaptcha.getResponse();
      //alert(response);
      //$form.find('input[name="g-recaptcha-response"]').val(response);


    }
  });
});
/*When clicking on Full hide fail/success boxes */
$('#inputFullname').focus(function() {
  $('#success').html('');
});
// END CONTACT FORM

// accordion initialization in section template 4 boxes template 1
$( function() {
    $(".sn-4-bx-1 .boxes-accordion").accordion({
        active: false,
        collapsible: true,
        header: ".box-header",
        heightStyle: "content",
        icons: { "header": "fa fa-plus", "activeHeader": "fa fa-minus" }
    });
});

// price type toggling
function updatePrices(priceType) {
    "use strict";
    // sync all switches
    $(".price-switch input[value=" + priceType + "]").prop("checked", true);
    // update prices
    $(".price-var").each(function () {
        if (priceType === 'brutto') {
            $(this).addClass('price-type-gross');
        } else {
            $(this).removeClass('price-type-gross');
        }
    })
}
$(function () {
    "use strict";
    $(".price-switch input").on("change", function () {
        var priceType = $(this).val();
        updatePrices(priceType);
        localStorage.setItem("price_type", priceType);
    })
    // setup on page load, net is the default, so update only on gross
    if (localStorage.getItem("price_type") === 'brutto') {
        updatePrices('brutto');
    }
});
