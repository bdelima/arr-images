'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Live Tdarr flow "Validator" (original flow _id: Yaax7LBej), exported 2026-11-08, plus a Tag Output Metadata node (id tagOutMeta) in front of Replace Original File.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "Yaax7LBej",
    "name": "Validator",
    "description": "Validator",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Entry from Controller Flow (re-encoded)",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "FShP88xbj",
        "position": {
          "x": 552,
          "y": 168
        }
      },
      {
        "name": "Compare File Size Ratio",
        "sourceRepo": "Community",
        "pluginName": "compareFileSizeRatio",
        "version": "2.0.0",
        "fpEnabled": true,
        "id": "01GZNv02y",
        "position": {
          "x": 552,
          "y": 240
        },
        "inputsDB": {
          "greaterThan": "30"
        }
      },
      {
        "name": "Compare File Duration Ratio",
        "sourceRepo": "Community",
        "pluginName": "compareFileDurationRatio",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "CUsET8PD3",
        "position": {
          "x": 516,
          "y": 300
        }
      },
      {
        "name": "Fail Flow",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "WrieN1BV1",
        "position": {
          "x": 800,
          "y": 260
        }
      },
      {
        "name": "Check Video Resolution",
        "sourceRepo": "Community",
        "pluginName": "checkVideoResolution",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "checkRes4k",
        "position": {
          "x": 480,
          "y": 372
        }
      },
      {
        "name": "Check 10 Bit Video",
        "sourceRepo": "Community",
        "pluginName": "check10Bit",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "check10BitStd",
        "position": {
          "x": 324,
          "y": 468
        }
      },
      {
        "name": "Check 10 Bit Video (4K)",
        "sourceRepo": "Community",
        "pluginName": "check10Bit",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "check10Bit4k",
        "position": {
          "x": 630,
          "y": 444
        }
      },
      {
        "name": "Run VMAF Quality Check",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "userOutputFilePath": "{{{args.inputFileObj._id}}}",
          "cliArguments": "-c 'LOCKFILE=\"/temp/vmaf-cuda.lock\"; VMAFLOG=\"/temp/vmaf-$$.json\"; flock \"$LOCKFILE\" /usr/local/bin/ffmpeg-vmaf-cuda -xerror -stats_period 5 -hwaccel cuda -hwaccel_output_format cuda -i \"{{{args.originalLibraryFile._id}}}\" -hwaccel cuda -hwaccel_output_format cuda -i \"{{{args.inputFileObj._id}}}\" -an -filter_complex \"[0:v]scale_cuda=format=yuv420p[ref];[1:v]scale_cuda=format=yuv420p[dist];[dist][ref]libvmaf_cuda=log_path=$VMAFLOG:log_fmt=json\" -f null - 2>&1; EC=$?; if [ $EC -ne 0 ]; then echo \"ffmpeg-vmaf-cuda failed with exit $EC\"; rm -f \"$VMAFLOG\"; exit 1; fi; MEAN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"mean\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); MIN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"min\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); HMEAN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"harmonic_mean\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); FRAMES=\"/temp/vmaf-frames-$$.txt\"; sed -n \"/\\\"frames\\\": \\[/,/^  \\],/p\" \"$VMAFLOG\" | grep -oE \"\\\"vmaf\\\": [0-9.]+\" | sed -E \"s/.*: //\" | sort -n > \"$FRAMES\"; N=$(wc -l < \"$FRAMES\"); P=$(awk -v n=\"$N\" \"BEGIN{print 1*(n-1)/100}\"); IL=$(awk -v p=\"$P\" \"BEGIN{print int(p)}\"); IR=$(awk -v p=\"$P\" -v il=\"$IL\" \"BEGIN{print (p==il)?il:il+1}\"); LO=$(sed -n \"$((IL+1))p\" \"$FRAMES\"); HI=$(sed -n \"$((IR+1))p\" \"$FRAMES\"); P1=$(awk -v lo=\"$LO\" -v hi=\"$HI\" -v il=\"$IL\" -v ir=\"$IR\" -v p=\"$P\" \"BEGIN{if(il==ir) r=lo; else r=lo*(ir-p)+hi*(p-il); print r}\"); rm -f \"$FRAMES\"; echo \"VMAF score: mean=$MEAN min=$MIN harmonic_mean=$HMEAN p1=$P1 n=$N\"; rm -f \"$VMAFLOG\"; awk -v s=\"$MEAN\" \"BEGIN{exit !(s>=93)}\"'"
        },
        "fpEnabled": true,
        "id": "vmafCheck1",
        "position": {
          "x": 432,
          "y": 552
        }
      },
      {
        "name": "Run VMAF Quality Check (10-bit)",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "userOutputFilePath": "{{{args.inputFileObj._id}}}",
          "cliArguments": "-c 'LOCKFILE=\"/temp/vmaf-cuda.lock\"; VMAFLOG=\"/temp/vmaf-$$.json\"; flock \"$LOCKFILE\" /usr/local/bin/ffmpeg-vmaf-cuda -xerror -stats_period 5 -hwaccel cuda -hwaccel_output_format cuda -i \"{{{args.originalLibraryFile._id}}}\" -hwaccel cuda -hwaccel_output_format cuda -i \"{{{args.inputFileObj._id}}}\" -an -filter_complex \"[0:v]scale_cuda=format=yuv420p10le[ref];[1:v]scale_cuda=format=yuv420p10le[dist];[dist][ref]libvmaf_cuda=log_path=$VMAFLOG:log_fmt=json\" -f null - 2>&1; EC=$?; if [ $EC -ne 0 ]; then echo \"ffmpeg-vmaf-cuda failed with exit $EC\"; rm -f \"$VMAFLOG\"; exit 1; fi; MEAN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"mean\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); MIN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"min\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); HMEAN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"harmonic_mean\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); FRAMES=\"/temp/vmaf-frames-$$.txt\"; sed -n \"/\\\"frames\\\": \\[/,/^  \\],/p\" \"$VMAFLOG\" | grep -oE \"\\\"vmaf\\\": [0-9.]+\" | sed -E \"s/.*: //\" | sort -n > \"$FRAMES\"; N=$(wc -l < \"$FRAMES\"); P=$(awk -v n=\"$N\" \"BEGIN{print 1*(n-1)/100}\"); IL=$(awk -v p=\"$P\" \"BEGIN{print int(p)}\"); IR=$(awk -v p=\"$P\" -v il=\"$IL\" \"BEGIN{print (p==il)?il:il+1}\"); LO=$(sed -n \"$((IL+1))p\" \"$FRAMES\"); HI=$(sed -n \"$((IR+1))p\" \"$FRAMES\"); P1=$(awk -v lo=\"$LO\" -v hi=\"$HI\" -v il=\"$IL\" -v ir=\"$IR\" -v p=\"$P\" \"BEGIN{if(il==ir) r=lo; else r=lo*(ir-p)+hi*(p-il); print r}\"); rm -f \"$FRAMES\"; echo \"VMAF score: mean=$MEAN min=$MIN harmonic_mean=$HMEAN p1=$P1 n=$N\"; rm -f \"$VMAFLOG\"; awk -v s=\"$MEAN\" \"BEGIN{exit !(s>=93)}\"'"
        },
        "fpEnabled": true,
        "id": "vmafCheck1_10bit",
        "position": {
          "x": 264,
          "y": 552
        }
      },
      {
        "name": "Run VMAF Quality Check (4K model)",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "userOutputFilePath": "{{{args.inputFileObj._id}}}",
          "cliArguments": "-c 'LOCKFILE=\"/temp/vmaf-cuda.lock\"; VMAFLOG=\"/temp/vmaf-$$.json\"; flock \"$LOCKFILE\" /usr/local/bin/ffmpeg-vmaf-cuda -xerror -stats_period 5 -hwaccel cuda -hwaccel_output_format cuda -i \"{{{args.originalLibraryFile._id}}}\" -hwaccel cuda -hwaccel_output_format cuda -i \"{{{args.inputFileObj._id}}}\" -an -filter_complex \"[0:v]scale_cuda=format=yuv420p[ref];[1:v]scale_cuda=format=yuv420p[dist];[dist][ref]libvmaf_cuda=model=version=vmaf_4k_v0.6.1:log_path=$VMAFLOG:log_fmt=json\" -f null - 2>&1; EC=$?; if [ $EC -ne 0 ]; then echo \"ffmpeg-vmaf-cuda failed with exit $EC\"; rm -f \"$VMAFLOG\"; exit 1; fi; MEAN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"mean\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); MIN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"min\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); HMEAN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"harmonic_mean\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); FRAMES=\"/temp/vmaf-frames-$$.txt\"; sed -n \"/\\\"frames\\\": \\[/,/^  \\],/p\" \"$VMAFLOG\" | grep -oE \"\\\"vmaf\\\": [0-9.]+\" | sed -E \"s/.*: //\" | sort -n > \"$FRAMES\"; N=$(wc -l < \"$FRAMES\"); P=$(awk -v n=\"$N\" \"BEGIN{print 1*(n-1)/100}\"); IL=$(awk -v p=\"$P\" \"BEGIN{print int(p)}\"); IR=$(awk -v p=\"$P\" -v il=\"$IL\" \"BEGIN{print (p==il)?il:il+1}\"); LO=$(sed -n \"$((IL+1))p\" \"$FRAMES\"); HI=$(sed -n \"$((IR+1))p\" \"$FRAMES\"); P1=$(awk -v lo=\"$LO\" -v hi=\"$HI\" -v il=\"$IL\" -v ir=\"$IR\" -v p=\"$P\" \"BEGIN{if(il==ir) r=lo; else r=lo*(ir-p)+hi*(p-il); print r}\"); rm -f \"$FRAMES\"; echo \"VMAF score: mean=$MEAN min=$MIN harmonic_mean=$HMEAN p1=$P1 n=$N\"; rm -f \"$VMAFLOG\"; awk -v s=\"$MEAN\" \"BEGIN{exit !(s>=93)}\"'"
        },
        "fpEnabled": true,
        "id": "vmafCheck4k",
        "position": {
          "x": 768,
          "y": 552
        }
      },
      {
        "name": "Run VMAF Quality Check (4K model, 10-bit)",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "userOutputFilePath": "{{{args.inputFileObj._id}}}",
          "cliArguments": "-c 'LOCKFILE=\"/temp/vmaf-cuda.lock\"; VMAFLOG=\"/temp/vmaf-$$.json\"; flock \"$LOCKFILE\" /usr/local/bin/ffmpeg-vmaf-cuda -xerror -stats_period 5 -hwaccel cuda -hwaccel_output_format cuda -i \"{{{args.originalLibraryFile._id}}}\" -hwaccel cuda -hwaccel_output_format cuda -i \"{{{args.inputFileObj._id}}}\" -an -filter_complex \"[0:v]scale_cuda=format=yuv420p10le[ref];[1:v]scale_cuda=format=yuv420p10le[dist];[dist][ref]libvmaf_cuda=model=version=vmaf_4k_v0.6.1:log_path=$VMAFLOG:log_fmt=json\" -f null - 2>&1; EC=$?; if [ $EC -ne 0 ]; then echo \"ffmpeg-vmaf-cuda failed with exit $EC\"; rm -f \"$VMAFLOG\"; exit 1; fi; MEAN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"mean\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); MIN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"min\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); HMEAN=$(grep -A5 \"\\\"vmaf\\\"\" \"$VMAFLOG\" | grep \"\\\"harmonic_mean\\\"\" | head -1 | sed -E \"s/[^0-9.]+//g\"); FRAMES=\"/temp/vmaf-frames-$$.txt\"; sed -n \"/\\\"frames\\\": \\[/,/^  \\],/p\" \"$VMAFLOG\" | grep -oE \"\\\"vmaf\\\": [0-9.]+\" | sed -E \"s/.*: //\" | sort -n > \"$FRAMES\"; N=$(wc -l < \"$FRAMES\"); P=$(awk -v n=\"$N\" \"BEGIN{print 1*(n-1)/100}\"); IL=$(awk -v p=\"$P\" \"BEGIN{print int(p)}\"); IR=$(awk -v p=\"$P\" -v il=\"$IL\" \"BEGIN{print (p==il)?il:il+1}\"); LO=$(sed -n \"$((IL+1))p\" \"$FRAMES\"); HI=$(sed -n \"$((IR+1))p\" \"$FRAMES\"); P1=$(awk -v lo=\"$LO\" -v hi=\"$HI\" -v il=\"$IL\" -v ir=\"$IR\" -v p=\"$P\" \"BEGIN{if(il==ir) r=lo; else r=lo*(ir-p)+hi*(p-il); print r}\"); rm -f \"$FRAMES\"; echo \"VMAF score: mean=$MEAN min=$MIN harmonic_mean=$HMEAN p1=$P1 n=$N\"; rm -f \"$VMAFLOG\"; awk -v s=\"$MEAN\" \"BEGIN{exit !(s>=93)}\"'"
        },
        "fpEnabled": true,
        "id": "vmafCheck4k_10bit",
        "position": {
          "x": 600,
          "y": 552
        }
      },
      {
        "name": "Tag Output Metadata",
        "sourceRepo": "Local",
        "pluginName": "tagOutputMetadata",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "tagOutMeta",
        "position": {
          "x": 960,
          "y": 700
        }
      },
      {
        "name": "Replace Original File",
        "sourceRepo": "Community",
        "pluginName": "replaceOriginalFile",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "1g5GNL1MP",
        "position": {
          "x": 960,
          "y": 780
        }
      },
      {
        "name": "Entry from Controller Flow (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "FShP88xbjPT",
        "position": {
          "x": 1092,
          "y": 168
        }
      },
      {
        "name": "Compare File Size Ratio (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "compareFileSizeRatio",
        "version": "2.0.0",
        "fpEnabled": true,
        "id": "01GZNv02yPT",
        "position": {
          "x": 1356,
          "y": 228
        }
      },
      {
        "name": "Compare File Duration Ratio (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "compareFileDurationRatio",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "CUsET8PD3PT",
        "position": {
          "x": 1236,
          "y": 204
        }
      },
      {
        "name": "Queue Full Healthcheck",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "healthcheck-full"
        },
        "fpEnabled": true,
        "id": "reqOjochalHC",
        "position": {
          "x": 1284,
          "y": 372
        }
      },
      {
        "name": "Run Thorough Health Check",
        "sourceRepo": "Community",
        "pluginName": "runHealthCheck",
        "version": "1.0.0",
        "inputsDB": {
          "type": "thorough",
          "gpuAcceleration": "qsv"
        },
        "fpEnabled": true,
        "id": "healthCheckPT",
        "position": {
          "x": 1284,
          "y": 432
        }
      },
      {
        "name": "Queue back to local",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "local"
        },
        "fpEnabled": true,
        "id": "reqLocalPT",
        "position": {
          "x": 1284,
          "y": 492
        }
      },
      {
        "name": "Mark step: landed for health check",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-hc-queue"
        },
        "fpEnabled": true,
        "id": "valMarkHcQueue",
        "position": {
          "x": 1284,
          "y": 402
        }
      },
      {
        "name": "Mark step: thorough health check done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-hc-done"
        },
        "fpEnabled": true,
        "id": "valMarkHcDone",
        "position": {
          "x": 1284,
          "y": 462
        }
      },
      {
        "name": "Mark step: back on local",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-back-local"
        },
        "fpEnabled": true,
        "id": "valMarkBackLocal",
        "position": {
          "x": 1284,
          "y": 522
        }
      },
      {
        "name": "Require health check before Replace",
        "sourceRepo": "Local",
        "pluginName": "requireTrail",
        "version": "1.0.0",
        "inputsDB": {
          "requiredLabels": "validator-hc-queue,validator-hc-done,validator-back-local"
        },
        "fpEnabled": true,
        "id": "valRequireHc",
        "position": {
          "x": 1284,
          "y": 552
        }
      }
    ],
    "flowEdges": [
      {
        "source": "FShP88xbj",
        "sourceHandle": "1",
        "target": "01GZNv02y",
        "targetHandle": null,
        "id": "rTL0zUBDZ"
      },
      {
        "source": "01GZNv02y",
        "sourceHandle": "1",
        "target": "CUsET8PD3",
        "targetHandle": null,
        "id": "pzyuFoO69"
      },
      {
        "source": "01GZNv02y",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "4nXCOOWNQ"
      },
      {
        "source": "CUsET8PD3",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "U2MS0RqpE"
      },
      {
        "source": "CUsET8PD3",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "6FytNy0H9"
      },
      {
        "source": "CUsET8PD3",
        "sourceHandle": "1",
        "target": "checkRes4k",
        "targetHandle": null,
        "id": "T6akumt4z"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "1",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res480ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "2",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res576ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "3",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res720ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "4",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res1080ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "5",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res1440ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "8",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res8kToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "9",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "resOtherToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "6",
        "target": "check10Bit4k",
        "targetHandle": null,
        "id": "res4kuhdToBit4k"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "7",
        "target": "check10Bit4k",
        "targetHandle": null,
        "id": "resDci4kToBit4k"
      },
      {
        "source": "check10BitStd",
        "sourceHandle": "1",
        "target": "vmafCheck1_10bit",
        "targetHandle": null,
        "id": "bitStdToVmaf10bit"
      },
      {
        "source": "check10BitStd",
        "sourceHandle": "2",
        "target": "vmafCheck1",
        "targetHandle": null,
        "id": "bitStdToVmaf8bit"
      },
      {
        "source": "check10Bit4k",
        "sourceHandle": "1",
        "target": "vmafCheck4k_10bit",
        "targetHandle": null,
        "id": "bit4kToVmaf10bit"
      },
      {
        "source": "check10Bit4k",
        "sourceHandle": "2",
        "target": "vmafCheck4k",
        "targetHandle": null,
        "id": "bit4kToVmaf8bit"
      },
      {
        "source": "vmafCheck1",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "vmafPassEdge"
      },
      {
        "source": "vmafCheck1_10bit",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "vmaf10bitPassEdge"
      },
      {
        "source": "vmafCheck4k",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "vmaf4kPassEdge"
      },
      {
        "source": "vmafCheck4k_10bit",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "vmaf4k10bitPassEdge"
      },
      {
        "source": "FShP88xbjPT",
        "sourceHandle": "1",
        "target": "01GZNv02yPT",
        "targetHandle": null,
        "id": "rTL0zUBDZPT"
      },
      {
        "source": "01GZNv02yPT",
        "sourceHandle": "1",
        "target": "CUsET8PD3PT",
        "targetHandle": null,
        "id": "pzyuFoO69PT"
      },
      {
        "source": "01GZNv02yPT",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "PfcElFxTMPT"
      },
      {
        "source": "01GZNv02yPT",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "4nXCOOWNQPT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "U2MS0RqpEPT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "6FytNy0H9PT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "1",
        "target": "reqOjochalHC",
        "targetHandle": null,
        "id": "ratioToReqOjochal"
      },
      {
        "source": "reqOjochalHC",
        "sourceHandle": "1",
        "target": "valMarkHcQueue",
        "targetHandle": null,
        "id": "reqOjochalToHC"
      },
      {
        "source": "healthCheckPT",
        "sourceHandle": "1",
        "target": "valMarkHcDone",
        "targetHandle": null,
        "id": "hcToReqLocal"
      },
      {
        "source": "reqLocalPT",
        "sourceHandle": "1",
        "target": "valMarkBackLocal",
        "targetHandle": null,
        "id": "reqLocalToReplace"
      },
      {
        "source": "01GZNv02y",
        "sourceHandle": "2",
        "target": "01GZNv02y",
        "targetHandle": null,
        "id": "0ds-weFG1"
      },
      {
        "source": "tagOutMeta",
        "sourceHandle": "1",
        "target": "1g5GNL1MP",
        "targetHandle": null,
        "id": "tagMetaToReplace"
      },
      {
        "source": "valMarkHcQueue",
        "sourceHandle": "1",
        "target": "healthCheckPT",
        "targetHandle": null,
        "id": "reqOjochalToHCb"
      },
      {
        "source": "valMarkHcDone",
        "sourceHandle": "1",
        "target": "reqLocalPT",
        "targetHandle": null,
        "id": "hcToReqLocalb"
      },
      {
        "source": "valMarkBackLocal",
        "sourceHandle": "1",
        "target": "valRequireHc",
        "targetHandle": null,
        "id": "reqLocalToReplaceb"
      },
      {
        "source": "valRequireHc",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "gateToTagMeta"
      },
      {
        "source": "valRequireHc",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "gateToFail"
      }
    ]
  });
exports.details = details;
